using GZCTF.Models.Data;
using GZCTF.Models.Request.Assets;

namespace GZCTF.Services.Upload;

public interface IResumableUploadService
{
    Task<ResumableUploadTicket> CreateSessionAsync(ResumableUploadRequest request, CancellationToken token = default);

    Task<ResumableUploadTicket?> GetSessionAsync(Guid uploadId, CancellationToken token = default);

    Task<ResumableUploadTicket> UploadChunkAsync(Guid uploadId, int chunkIndex, Stream content, long contentLength,
        CancellationToken token = default);

    Task<LocalFile> CompleteAsync(Guid uploadId, CancellationToken token = default);

    Task AbortAsync(Guid uploadId, CancellationToken token = default);
}
