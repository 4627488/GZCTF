using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using System.Linq;
using GZCTF.Models.Data;
using GZCTF.Models.Request.Assets;
using GZCTF.Repositories.Interface;
using GZCTF.Utils;

namespace GZCTF.Services.Upload;

public class ResumableUploadService(ILogger<ResumableUploadService> logger, IBlobRepository blobRepository)
    : IResumableUploadService
{
    const int DefaultChunkSize = 4 * 1024 * 1024;
    const int MinChunkSize = 256 * 1024;
    const int MaxChunkSize = 16 * 1024 * 1024;
    static readonly TimeSpan SessionLifetime = TimeSpan.FromHours(6);

    static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    readonly ConcurrentDictionary<Guid, SemaphoreSlim> _locks = new();
    readonly string _rootDirectory = Path.Combine(PathHelper.Base, PathHelper.Uploads, "_resumable");

    public async Task<ResumableUploadTicket> CreateSessionAsync(ResumableUploadRequest request,
        CancellationToken token = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        CleanupExpiredSessions();

        var chunkSize = NormalizeChunkSize(request.ChunkSize);
        if (request.FileSize / chunkSize >= int.MaxValue)
            throw new InvalidOperationException("File is too large for the configured chunk size.");

        var session = new ResumableUploadSession
        {
            Id = Guid.NewGuid(),
            FileName = string.IsNullOrWhiteSpace(request.FileName) ? $"upload-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}" : request.FileName,
            FileSize = request.FileSize,
            ContentType = string.IsNullOrWhiteSpace(request.ContentType) ? null : request.ContentType,
            ChunkSize = chunkSize,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        var directory = EnsureSessionDirectory(session.Id);
        await using (var stream = File.Create(GetMetadataPath(session.Id)))
        {
            await JsonSerializer.SerializeAsync(stream, session, JsonOptions, token);
        }

        logger.LogDebug("Created upload session {UploadId} for file {File} ({Size} bytes)", session.Id,
            session.FileName, session.FileSize);

        return ToTicket(session);
    }

    public async Task<ResumableUploadTicket?> GetSessionAsync(Guid uploadId, CancellationToken token = default)
    {
        CleanupExpiredSessions();
        var session = await LoadSessionAsync(uploadId, token);
        return session is null ? null : ToTicket(session);
    }

    public async Task<ResumableUploadTicket> UploadChunkAsync(Guid uploadId, int chunkIndex, Stream content,
        long contentLength, CancellationToken token = default)
    {
        if (chunkIndex < 0)
            throw new ArgumentOutOfRangeException(nameof(chunkIndex));

        ArgumentNullException.ThrowIfNull(content);

        CleanupExpiredSessions();
        var session = await LoadSessionAsync(uploadId, token) ??
                      throw new FileNotFoundException("Upload session not found", uploadId.ToString());

        var sessionLock = _locks.GetOrAdd(uploadId, _ => new SemaphoreSlim(1, 1));
        await sessionLock.WaitAsync(token);
        try
        {
            var chunkCount = (int)Math.Ceiling(session.FileSize / (double)session.ChunkSize);
            if (chunkIndex >= chunkCount)
                throw new ArgumentOutOfRangeException(nameof(chunkIndex));

            if (contentLength <= 0)
                throw new InvalidOperationException("Chunk content length must be positive.");
            var expectedLength = chunkIndex == chunkCount - 1
                ? session.FileSize - (long)session.ChunkSize * (chunkCount - 1)
                : session.ChunkSize;

            if (expectedLength <= 0)
                expectedLength = session.ChunkSize;

            if (contentLength > expectedLength)
                throw new InvalidOperationException("Chunk size exceeds configured limit.");

            var directory = EnsureSessionDirectory(uploadId);
            var chunkPath = GetChunkPath(uploadId, chunkIndex);

            await using (var file = File.Create(chunkPath))
            {
                await content.CopyToAsync(file, token);
            }

            session.UploadedChunks.Add(chunkIndex);
            session.UploadedBytes = CalculateUploadedBytes(directory);

            await SaveSessionAsync(session, token);

            return ToTicket(session);
        }
        finally
        {
            sessionLock.Release();
        }
    }

    public async Task<LocalFile> CompleteAsync(Guid uploadId, CancellationToken token = default)
    {
        CleanupExpiredSessions();
        var session = await LoadSessionAsync(uploadId, token) ??
                      throw new FileNotFoundException("Upload session not found", uploadId.ToString());

        var sessionLock = _locks.GetOrAdd(uploadId, _ => new SemaphoreSlim(1, 1));
        await sessionLock.WaitAsync(token);
        try
        {
            var chunkCount = (int)Math.Ceiling(session.FileSize / (double)session.ChunkSize);
            if (session.UploadedChunks.Count != chunkCount)
                throw new InvalidOperationException("Upload session is incomplete.");

            var directory = EnsureSessionDirectory(uploadId);
            await using Stream temp = BufferHelper.GetTempStream(session.FileSize);

            for (var index = 0; index < chunkCount; index++)
            {
                var chunkPath = GetChunkPath(uploadId, index);
                if (!File.Exists(chunkPath))
                    throw new FileNotFoundException("Missing chunk during completion", chunkPath);

                await using var chunk = File.OpenRead(chunkPath);
                await chunk.CopyToAsync(temp, token);
            }

            if (temp.Length != session.FileSize)
            {
                temp.Position = 0;
                logger.LogWarning("Upload session {UploadId} size mismatch. Expected {Expected}, got {Actual}",
                    uploadId, session.FileSize, temp.Length);
            }

            temp.Position = 0;
            var result = await blobRepository.CreateOrUpdateBlob(temp, session.FileName, token);

            await CleanupSessionAsync(session);

            logger.LogInformation("Completed upload session {UploadId} -> {Hash}", uploadId, result.Hash);

            return result;
        }
        finally
        {
            sessionLock.Release();
            _locks.TryRemove(uploadId, out _);
        }
    }

    public async Task AbortAsync(Guid uploadId, CancellationToken token = default)
    {
        var sessionLock = _locks.GetOrAdd(uploadId, _ => new SemaphoreSlim(1, 1));
        await sessionLock.WaitAsync(token);
        try
        {
            var session = await LoadSessionAsync(uploadId, token);
            if (session is not null)
                await CleanupSessionAsync(session);
        }
        finally
        {
            sessionLock.Release();
            _locks.TryRemove(uploadId, out _);
        }
    }

    static int NormalizeChunkSize(int? chunkSize)
    {
        if (!chunkSize.HasValue)
            return DefaultChunkSize;

        return Math.Clamp(chunkSize.Value, MinChunkSize, MaxChunkSize);
    }

    async Task<ResumableUploadSession?> LoadSessionAsync(Guid uploadId, CancellationToken token)
    {
        var metaPath = GetMetadataPath(uploadId);
        if (!File.Exists(metaPath))
            return null;

        await using var stream = File.OpenRead(metaPath);
        var session = await JsonSerializer.DeserializeAsync<ResumableUploadSession>(stream, JsonOptions, token);

        if (session is null)
            return null;

        var directory = EnsureSessionDirectory(uploadId);
        session.UploadedChunks = Directory.EnumerateFiles(directory, "*.chunk")
            .Select(Path.GetFileNameWithoutExtension)
            .Where(name => name is not null)
            .Select(name => int.TryParse(name, out var index) ? index : (int?)null)
            .Where(index => index.HasValue)
            .Select(index => index!.Value)
            .ToHashSet();
        session.UploadedChunks ??= new HashSet<int>();
        session.UploadedBytes = CalculateUploadedBytes(directory);

        if (session.CreatedAt + SessionLifetime < DateTimeOffset.UtcNow)
        {
            await CleanupSessionAsync(session);
            return null;
        }

        return session;
    }

    async Task SaveSessionAsync(ResumableUploadSession session, CancellationToken token)
    {
        await using var stream = File.Create(GetMetadataPath(session.Id));
        await JsonSerializer.SerializeAsync(stream, session, JsonOptions, token);
    }

    async Task CleanupSessionAsync(ResumableUploadSession session)
    {
        var directory = GetSessionDirectory(session.Id);
        if (Directory.Exists(directory))
            Directory.Delete(directory, true);

        logger.LogDebug("Cleaned upload session {UploadId}", session.Id);
        await Task.CompletedTask;
    }

    long CalculateUploadedBytes(string directory)
    {
        if (!Directory.Exists(directory))
            return 0;

        return Directory.EnumerateFiles(directory, "*.chunk")
            .Select(file => new FileInfo(file))
            .Sum(info => info.Length);
    }

    string EnsureSessionDirectory(Guid uploadId)
    {
        Directory.CreateDirectory(_rootDirectory);
        var directory = GetSessionDirectory(uploadId);
        Directory.CreateDirectory(directory);
        return directory;
    }

    string GetSessionDirectory(Guid uploadId) => Path.Combine(_rootDirectory, uploadId.ToString("N"));

    string GetChunkPath(Guid uploadId, int chunkIndex) => Path.Combine(GetSessionDirectory(uploadId),
        $"{chunkIndex:D6}.chunk");

    string GetMetadataPath(Guid uploadId) => Path.Combine(GetSessionDirectory(uploadId), "session.json");

    ResumableUploadTicket ToTicket(ResumableUploadSession session) => new()
    {
        UploadId = session.Id,
        FileName = session.FileName,
        FileSize = session.FileSize,
        ChunkSize = session.ChunkSize,
        UploadedBytes = session.UploadedBytes,
        UploadedChunks = session.UploadedChunks.Order().ToArray(),
        ExpiresAt = session.CreatedAt + SessionLifetime
    };

    void CleanupExpiredSessions()
    {
        if (!Directory.Exists(_rootDirectory))
            return;

        foreach (var directory in Directory.EnumerateDirectories(_rootDirectory))
        {
            try
            {
                var metaPath = Path.Combine(directory, "session.json");
                if (!File.Exists(metaPath))
                {
                    Directory.Delete(directory, true);
                    continue;
                }

                var info = new FileInfo(metaPath);
                var expiresAt = new DateTimeOffset(info.LastWriteTimeUtc, TimeSpan.Zero) + SessionLifetime;
                if (expiresAt < DateTimeOffset.UtcNow)
                    Directory.Delete(directory, true);
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "Failed to cleanup upload session directory {Directory}", directory);
            }
        }
    }

    class ResumableUploadSession
    {
        public Guid Id { get; set; }
        public string FileName { get; set; } = string.Empty;
        public long FileSize { get; set; }
        public string? ContentType { get; set; }
        public int ChunkSize { get; set; }
        public long UploadedBytes { get; set; }
        public DateTimeOffset CreatedAt { get; set; }
        public HashSet<int> UploadedChunks { get; set; } = new();
    }
}
