using System.ComponentModel.DataAnnotations;
using System.Net.Mime;
using FluentStorage;
using FluentStorage.Blobs;
using GZCTF.Middlewares;
using GZCTF.Models.Data;
using GZCTF.Models.Request.Assets;
using GZCTF.Repositories.Interface;
using GZCTF.Services.Upload;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Localization;
using Microsoft.Net.Http.Headers;

namespace GZCTF.Controllers;

/// <summary>
/// File APIs
/// </summary>
[ApiController]
[ProducesResponseType(typeof(RequestResponse), StatusCodes.Status401Unauthorized)]
[ProducesResponseType(typeof(RequestResponse), StatusCodes.Status403Forbidden)]
public class AssetsController(
    IBlobStorage storage,
    IBlobRepository blobService,
    IResumableUploadService uploadService,
    ILogger<AssetsController> logger,
    IStringLocalizer<Program> localizer) : ControllerBase
{
    readonly FileExtensionContentTypeProvider _extProvider = new();

    /// <summary>
    /// File retrieval interface
    /// </summary>
    /// <remarks>
    /// Retrieve a file by hash, filename is not matched
    /// </remarks>
    /// <param name="hash">File hash</param>
    /// <param name="filename">Download filename</param>
    /// <param name="token"></param>
    /// <response code="200">File retrieved successfully</response>
    /// <response code="404">File not found</response>
    /// <response code="400">Failed to retrieve file</response>
    [HttpGet("[controller]/{hash:length(64)}/{filename:minlength(1)}")]
    [ResponseCache(Duration = 60 * 60 * 24 * 7)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(RequestResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(RequestResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetFile([RegularExpression("[0-9a-f]{64}")] string hash, string filename,
        CancellationToken token)
    {
        var path = StoragePath.Combine(PathHelper.Uploads, hash[..2], hash[2..4], hash);

        if (!await storage.ExistsAsync(path, token))
        {
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "0.0.0.0";
            logger.Log(StaticLocalizer[nameof(Resources.Program.Assets_FileNotFound), hash[..8], filename], ip,
                TaskStatus.NotFound,
                LogLevel.Warning);
            return NotFound(new RequestResponse(localizer[nameof(Resources.Program.File_NotFound)],
                StatusCodes.Status404NotFound));
        }

        if (!_extProvider.TryGetContentType(filename, out var contentType))
            contentType = MediaTypeNames.Application.Octet;

        var blob = await storage.GetBlobAsync(path, token);

        var stream = await storage.OpenReadAsync(path, token);
        var etag = new EntityTagHeaderValue($"\"{hash[8..16]}\"");

        return File(stream, contentType, filename, blob.LastModificationTime, etag);
    }

    /// <summary>
    /// File upload interface
    /// </summary>
    /// <remarks>
    /// Upload one or more files
    /// </remarks>
    /// <param name="files"></param>
    /// <param name="filename">Unified filename</param>
    /// <param name="token"></param>
    /// <response code="200">File(s) uploaded successfully</response>
    /// <response code="400">Failed to upload file(s)</response>
    /// <response code="401">Unauthorized user</response>
    /// <response code="403">Access denied</response>
    [RequireAdmin]
    [HttpPost("api/[controller]")]
    [ProducesResponseType(typeof(List<LocalFile>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(RequestResponse), StatusCodes.Status400BadRequest)]
    [RequestFormLimits(ValueLengthLimit = int.MaxValue, MultipartBodyLengthLimit = long.MaxValue)]
    public async Task<IActionResult> Upload(List<IFormFile> files, [FromQuery] string? filename,
        CancellationToken token)
    {
        try
        {
            List<LocalFile> results = [];
            foreach (var file in files.Where(file => file.Length > 0))
            {
                var res = await blobService.CreateOrUpdateBlob(file, filename, token);
                logger.SystemLog(
                    StaticLocalizer[nameof(Resources.Program.Assets_UpdateFile), res.Hash[..8],
                        filename ?? file.FileName, file.Length],
                    TaskStatus.Success, LogLevel.Debug);
                results.Add(res);
            }

            return Ok(results);
        }
        catch (Exception ex)
        {
            logger.LogErrorMessage(ex, ex.Message);
            return BadRequest(new RequestResponse(localizer[nameof(Resources.Program.Assets_IOError)]));
        }
    }

    /// <summary>
    /// File deletion interface
    /// </summary>
    /// <remarks>
    /// Delete a file by hash
    /// </remarks>
    /// <param name="hash"></param>
    /// <param name="token"></param>
    /// <response code="200">File deleted successfully</response>
    /// <response code="400">Failed to delete file</response>
    /// <response code="401">Unauthorized user</response>
    /// <response code="403">Access denied</response>
    [RequireAdmin]
    [HttpDelete("api/[controller]/{hash:length(64)}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(RequestResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Delete(string hash, CancellationToken token)
    {
        var result = await blobService.DeleteBlobByHash(hash, token);

        logger.SystemLog(StaticLocalizer[nameof(Resources.Program.Assets_DeleteFile), hash[..8]], result,
            LogLevel.Information);

        return result switch
        {
            TaskStatus.Success => Ok(),
            TaskStatus.NotFound => NotFound(),
            _ => BadRequest(new RequestResponse(localizer[nameof(Resources.Program.File_DeletionFailed)]))
        };
    }

    /// <summary>
    /// Create a resumable upload session
    /// </summary>
    /// <remarks>
    /// Use this endpoint to upload large attachments reliably.
    /// </remarks>
    [RequireAdmin]
    [HttpPost("api/[controller]/resumable")]
    [ProducesResponseType(typeof(ResumableUploadTicket), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(RequestResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CreateResumable([FromBody] ResumableUploadRequest request,
        CancellationToken token)
    {
        try
        {
            var session = await uploadService.CreateSessionAsync(request, token);
            return Ok(session);
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            logger.LogWarning(ex, "Failed to create upload session");
            return BadRequest(new RequestResponse(localizer[nameof(Resources.Program.Assets_IOError)]));
        }
    }

    /// <summary>
    /// Get resumable upload session status
    /// </summary>
    [RequireAdmin]
    [HttpGet("api/[controller]/resumable/{uploadId:guid}")]
    [ProducesResponseType(typeof(ResumableUploadTicket), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(RequestResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetResumable([FromRoute] Guid uploadId, CancellationToken token)
    {
        var session = await uploadService.GetSessionAsync(uploadId, token);
        if (session is null)
            return NotFound(new RequestResponse(localizer[nameof(Resources.Program.File_NotFound)],
                StatusCodes.Status404NotFound));

        return Ok(session);
    }

    /// <summary>
    /// Upload a resumable chunk
    /// </summary>
    [RequireAdmin]
    [HttpPut("api/[controller]/resumable/{uploadId:guid}/chunks/{index:int}")]
    [Consumes(MediaTypeNames.Application.Octet)]
    [ProducesResponseType(typeof(ResumableUploadTicket), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(RequestResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(RequestResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UploadChunk([FromRoute] Guid uploadId, [FromRoute] int index,
        CancellationToken token)
    {
        if (!Request.ContentLength.HasValue || Request.ContentLength.Value <= 0)
            return BadRequest(new RequestResponse(localizer[nameof(Resources.Program.File_SizeZero)]));

        try
        {
            var session = await uploadService.UploadChunkAsync(uploadId, index, Request.Body,
                Request.ContentLength.Value, token);
            return Ok(session);
        }
        catch (FileNotFoundException)
        {
            return NotFound(new RequestResponse(localizer[nameof(Resources.Program.File_NotFound)],
                StatusCodes.Status404NotFound));
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentOutOfRangeException)
        {
            logger.LogWarning(ex, "Failed to upload chunk {Index} for session {UploadId}", index, uploadId);
            return BadRequest(new RequestResponse(localizer[nameof(Resources.Program.Assets_IOError)]));
        }
    }

    /// <summary>
    /// Complete a resumable upload
    /// </summary>
    [RequireAdmin]
    [HttpPost("api/[controller]/resumable/{uploadId:guid}/complete")]
    [ProducesResponseType(typeof(LocalFile), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(RequestResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(RequestResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> CompleteResumable([FromRoute] Guid uploadId, CancellationToken token)
    {
        try
        {
            var file = await uploadService.CompleteAsync(uploadId, token);
            return Ok(file);
        }
        catch (FileNotFoundException)
        {
            return NotFound(new RequestResponse(localizer[nameof(Resources.Program.File_NotFound)],
                StatusCodes.Status404NotFound));
        }
        catch (Exception ex) when (ex is InvalidOperationException or IOException)
        {
            logger.LogWarning(ex, "Failed to complete upload session {UploadId}", uploadId);
            return BadRequest(new RequestResponse(localizer[nameof(Resources.Program.Assets_IOError)]));
        }
    }

    /// <summary>
    /// Abort a resumable upload session and clean temporary files
    /// </summary>
    [RequireAdmin]
    [HttpDelete("api/[controller]/resumable/{uploadId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> AbortResumable([FromRoute] Guid uploadId, CancellationToken token)
    {
        await uploadService.AbortAsync(uploadId, token);
        return NoContent();
    }
}
