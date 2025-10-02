import api, { LocalFile, ResumableUploadRequest, ResumableUploadTicket } from '@Api'

const FALLBACK_CHUNK_SIZE = 4 * 1024 * 1024

export type UploadProgressCallback = (uploadedBytes: number, totalBytes: number) => void

export interface SingleUploadOptions {
    onProgress?: UploadProgressCallback
    signal?: AbortSignal
    fileNameOverride?: string
}

export interface MultiUploadOptions {
    onProgress?: UploadProgressCallback
    signal?: AbortSignal
    resolveFileName?: (file: File, index: number) => string | undefined
    onFileStart?: (file: File, index: number) => void
    onFileProgress?: (file: File, index: number, uploadedBytes: number, totalBytes: number) => void
    onFileComplete?: (file: File, index: number, result: LocalFile) => void
    onFileError?: (file: File, index: number, error: unknown) => void
}

function normalizeTicket(ticket: ResumableUploadTicket | undefined): ResumableUploadTicket {
    return {
        uploadId: ticket?.uploadId,
        fileName: ticket?.fileName,
        fileSize: ticket?.fileSize,
        chunkSize: ticket?.chunkSize ?? FALLBACK_CHUNK_SIZE,
        uploadedBytes: ticket?.uploadedBytes ?? 0,
        uploadedChunks: ticket?.uploadedChunks ?? [],
        expiresAt: ticket?.expiresAt,
    }
}

export async function uploadFileResumable(file: File, options?: SingleUploadOptions): Promise<LocalFile> {
    const request: ResumableUploadRequest = {
        fileName: options?.fileNameOverride ?? file.name,
        fileSize: file.size,
        contentType: file.type || undefined,
    }

    let ticket = normalizeTicket((await api.assets.assetsCreateResumable(request, { signal: options?.signal })).data)

    const uploadId = ticket.uploadId
    if (!uploadId) {
        throw new Error('Failed to initialize upload session')
    }

    const chunkSize = ticket.chunkSize ?? FALLBACK_CHUNK_SIZE
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize))
    const uploadedSet = new Set(ticket.uploadedChunks)
    let uploadedBytes = ticket.uploadedBytes ?? 0

    const emitProgress = () => {
        options?.onProgress?.(Math.min(uploadedBytes, file.size), file.size)
    }

    emitProgress()

    try {
        for (let index = 0; index < totalChunks; index += 1) {
            if (uploadedSet.has(index)) {
                continue
            }

            const start = index * chunkSize
            const end = Math.min(start + chunkSize, file.size)
            const chunk = file.slice(start, end)

            ticket = normalizeTicket(
                (
                    await api.assets.assetsUploadChunk(uploadId, index, chunk, {
                        signal: options?.signal,
                    })
                ).data
            )

            uploadedBytes = ticket.uploadedBytes ?? uploadedBytes + chunk.size
            uploadedSet.add(index)
            emitProgress()
        }

        const result = await api.assets.assetsCompleteResumable(uploadId, { signal: options?.signal })
        uploadedBytes = file.size
        emitProgress()
        return result.data
    } catch (err) {
        try {
            await api.assets.assetsAbortResumable(uploadId, { signal: options?.signal })
        } catch (abortErr) {
            console.error('Failed to abort resumable upload', abortErr)
        }
        throw err
    }
}

export async function uploadFilesResumable(files: File[], options?: MultiUploadOptions): Promise<LocalFile[]> {
    const results: LocalFile[] = []
    let processedBytes = 0
    const totalBytes = files.reduce((acc, file) => acc + file.size, 0)

    options?.onProgress?.(0, totalBytes)

    if (totalBytes === 0) {
        return results
    }

    for (const [index, file] of files.entries()) {
        options?.onFileStart?.(file, index)

        try {
            const fileResult = await uploadFileResumable(file, {
                signal: options?.signal,
                fileNameOverride: options?.resolveFileName?.(file, index),
                onProgress: (uploaded, total) => {
                    const offset = processedBytes
                    options?.onProgress?.(offset + uploaded, totalBytes)
                    options?.onFileProgress?.(file, index, uploaded, total)
                },
            })

            processedBytes += file.size
            options?.onProgress?.(processedBytes, totalBytes)
            options?.onFileComplete?.(file, index, fileResult)
            results.push(fileResult)
        } catch (err) {
            options?.onFileError?.(file, index, err)
            throw err
        }
    }

    return results
}
