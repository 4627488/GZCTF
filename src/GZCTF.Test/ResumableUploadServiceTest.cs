using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using GZCTF.Models.Data;
using GZCTF.Models.Request.Assets;
using GZCTF.Repositories.Interface;
using GZCTF.Services.Upload;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using TaskStatus = GZCTF.Utils.TaskStatus;

namespace GZCTF.Test;

public class ResumableUploadServiceTest
{
    [Fact]
    public async Task CompleteAsync_StoresFileAndCleansSession()
    {
        // arrange
        var repository = new InMemoryBlobRepository();
        var logger = NullLogger<ResumableUploadService>.Instance;
        var service = new ResumableUploadService(logger, repository);

        var random = new Random(42);
        var content = new byte[4 * 1024 * 1024 + 4096];
        random.NextBytes(content);

        ResumableUploadRequest request = new()
        {
            FileName = "dyn.bin",
            FileSize = content.LongLength,
            ContentType = "application/octet-stream"
        };

        var ticket = await service.CreateSessionAsync(request);
        Assert.NotEqual(Guid.Empty, ticket.UploadId);
        Assert.True(ticket.ChunkSize > 0);

        var chunkSize = ticket.ChunkSize;
        var chunkCount = (int)Math.Ceiling(content.LongLength / (double)chunkSize);

        for (var index = 0; index < chunkCount; index++)
        {
            var start = index * chunkSize;
            var length = Math.Min(chunkSize, (int)(content.LongLength - start));
            await using var chunkStream = new MemoryStream(content, start, length, writable: false, publiclyVisible: true);
            await service.UploadChunkAsync(ticket.UploadId, index, chunkStream, length);
        }

        var result = await service.CompleteAsync(ticket.UploadId);

        Assert.Equal(request.FileName, result.Name);
        Assert.Equal(request.FileSize, result.FileSize);
        Assert.True(repository.StoredFiles.TryGetValue(result.Hash, out var stored));
        Assert.Equal(content.Length, stored.Length);
        Assert.True(content.SequenceEqual(stored));

        var sessionDir = Path.Combine("files", "uploads", "_resumable", ticket.UploadId.ToString("N"));
        Assert.False(Directory.Exists(sessionDir), "Upload session directory should be cleaned after completion");

        var rootDir = Path.Combine("files", "uploads", "_resumable");
        if (Directory.Exists(rootDir))
            Directory.Delete(rootDir, true);
    }

    sealed class InMemoryBlobRepository : IBlobRepository
    {
        public Dictionary<string, byte[]> StoredFiles { get; } = new();

        public Task<LocalFile> CreateOrUpdateBlob(IFormFile file, string? fileName = null,
            CancellationToken token = default) =>
            CreateOrUpdateBlob(file.OpenReadStream(), fileName ?? file.FileName, token);

        public async Task<LocalFile> CreateOrUpdateBlob(Stream stream, string fileName,
            CancellationToken token = default)
        {
            await using var memory = new MemoryStream();
            await stream.CopyToAsync(memory, token);
            memory.Position = 0;
            var hash = await SHA256.HashDataAsync(memory, token);
            var hex = Convert.ToHexString(hash).ToLowerInvariant();
            var bytes = memory.ToArray();
            StoredFiles[hex] = bytes;

            return new LocalFile
            {
                Hash = hex,
                Name = fileName,
                FileSize = bytes.LongLength
            };
        }

        public Task<TaskStatus> DeleteBlob(LocalFile file, CancellationToken token = default)
            => Task.FromResult(TaskStatus.Success);

        public Task<TaskStatus> DeleteBlobByHash(string fileHash, CancellationToken token = default)
            => Task.FromResult(TaskStatus.Success);

        public Task<LocalFile?> CreateOrUpdateImage(IFormFile file, string fileName, int resize,
            CancellationToken token = default)
            => Task.FromResult<LocalFile?>(null);

        public Task<LocalFile?> GetBlobByHash(string? fileHash, CancellationToken token = default)
            => Task.FromResult(fileHash is not null && StoredFiles.ContainsKey(fileHash)
                ? new LocalFile { Hash = fileHash, Name = fileHash, FileSize = StoredFiles[fileHash].LongLength }
                : null);

        public Task<LocalFile[]> GetBlobs(int count, int skip, CancellationToken token = default)
            => Task.FromResult(Array.Empty<LocalFile>());

        public Task DeleteAttachment(Attachment? attachment, CancellationToken token = default)
            => Task.CompletedTask;

        public void Add(object item) => throw new NotSupportedException();

        public Task<int> CountAsync(CancellationToken token = default)
            => Task.FromResult(StoredFiles.Count);

        public Task SaveAsync(CancellationToken token = default) => Task.CompletedTask;

        public Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken token = default)
            => throw new NotSupportedException();
    }
}
