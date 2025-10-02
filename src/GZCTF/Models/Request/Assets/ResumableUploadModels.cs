using System.ComponentModel.DataAnnotations;

namespace GZCTF.Models.Request.Assets;

public class ResumableUploadRequest
{
    const int MaxFileNameLength = 512;

    [Required]
    [StringLength(MaxFileNameLength)]
    public string FileName { get; set; } = string.Empty;

    [Required]
    [Range(1, long.MaxValue)]
    public long FileSize { get; set; }

    [Range(256 * 1024, 16 * 1024 * 1024)]
    public int? ChunkSize { get; set; }

    [StringLength(MaxFileNameLength)]
    public string? ContentType { get; set; }
}

public class ResumableUploadTicket
{
    public Guid UploadId { get; init; }

    public string FileName { get; init; } = string.Empty;

    public long FileSize { get; init; }

    public int ChunkSize { get; init; }

    public long UploadedBytes { get; init; }

    public IReadOnlyCollection<int> UploadedChunks { get; init; } = Array.Empty<int>();

    public DateTimeOffset ExpiresAt { get; init; }
}
