import {
  ActionIcon,
  Button,
  Card,
  Center,
  FileButton,
  Group,
  Modal,
  ModalProps,
  Overlay,
  Progress,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Title,
  alpha,
  useMantineColorScheme,
  useMantineTheme,
} from '@mantine/core'
import { showNotification } from '@mantine/notifications'
import { mdiAlertCircleOutline, mdiCheck, mdiCheckCircleOutline, mdiClockOutline, mdiClose, mdiCloudUploadOutline } from '@mdi/js'
import { Icon } from '@mdi/react'
import { FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { HunamizeSize, showErrorMsg } from '@Utils/Shared'
import { uploadFilesResumable } from '@Utils/ResumableUpload'
import { useEditChallenge } from '@Hooks/useEdit'
import api, { FileType } from '@Api'
import uploadClasses from '@Styles/Upload.module.css'

type FileUploadStatus = 'pending' | 'uploading' | 'completed' | 'error'

type FileUploadState = {
  name: string
  size: number
  uploaded: number
  status: FileUploadStatus
}

const statusIconMap: Record<FileUploadStatus, string> = {
  pending: mdiClockOutline,
  uploading: mdiCloudUploadOutline,
  completed: mdiCheckCircleOutline,
  error: mdiAlertCircleOutline,
}

const statusColorMap: Record<FileUploadStatus, string> = {
  pending: 'gray',
  uploading: 'cyan',
  completed: 'teal',
  error: 'red',
}

export const AttachmentUploadModal: FC<ModalProps> = (props) => {
  const { id, chalId } = useParams()
  const [numId, numCId] = [parseInt(id ?? '-1'), parseInt(chalId ?? '-1')]
  const uploadFileName = `DYN_ATTACHMENT_${numCId}`
  const [disabled, setDisabled] = useState(false)

  const { mutate } = useEditChallenge(numId, numCId)

  const [totalProgress, setTotalProgress] = useState(0)
  const [files, setFiles] = useState<File[]>([])
  const [fileStates, setFileStates] = useState<FileUploadState[]>([])

  const theme = useMantineTheme()
  const { colorScheme } = useMantineColorScheme()

  const { t } = useTranslation()

  const statusLabels = useMemo(
    () => ({
      pending: t('common.status.ready', { defaultValue: 'Ready' }),
      uploading: t('common.button.uploading'),
      completed: t('common.status.completed', { defaultValue: 'Completed' }),
      error: t('common.status.failed', { defaultValue: 'Failed' }),
    }),
    [t]
  )

  const initializeStates = (selected: File[]): FileUploadState[] =>
    selected.map((file) => ({
      name: file.name,
      size: file.size,
      uploaded: 0,
      status: 'pending',
    }))

  const handleSelectFiles = (selected: File[] | null) => {
    const safeSelection = selected ?? []
    setFiles(safeSelection)
    setFileStates(initializeStates(safeSelection))
    setTotalProgress(0)
  }

  const handleRemoveFile = (index: number) => {
    if (disabled) {
      return
    }

    setFiles((prev) => prev.filter((_, idx) => idx !== index))
    setFileStates((prev) => prev.filter((_, idx) => idx !== index))
  }

  const onUpload = async () => {
    if (files.length <= 0) {
      showNotification({
        color: 'red',
        message: t('admin.notification.games.challenges.attachment.no_selected'),
        icon: <Icon path={mdiClose} size={1} />,
      })
      return
    }

    setTotalProgress(0)
    setDisabled(true)
    setFileStates((states) =>
      states.map((state, index) => ({
        ...state,
        size: files[index]?.size ?? state.size,
        uploaded: 0,
        status: 'pending',
      }))
    )

    try {
      const uploaded = await uploadFilesResumable(files, {
        onProgress: (uploadedBytes, totalBytes) => {
          if (totalBytes === 0) {
            setTotalProgress(0)
            return
          }
          setTotalProgress((uploadedBytes / totalBytes) * 90)
        },
        resolveFileName: () => uploadFileName,
        onFileStart: (_, index) => {
          setFileStates((states) =>
            states.map((state, idx) =>
              idx === index
                ? {
                  ...state,
                  size: files[index]?.size ?? state.size,
                  uploaded: 0,
                  status: 'uploading',
                }
                : state
            )
          )
        },
        onFileProgress: (_, index, uploadedBytes, totalBytes) => {
          setFileStates((states) =>
            states.map((state, idx) =>
              idx === index
                ? {
                  ...state,
                  size: totalBytes,
                  uploaded: uploadedBytes,
                  status: 'uploading',
                }
                : state
            )
          )
        },
        onFileComplete: (_, index) => {
          setFileStates((states) =>
            states.map((state, idx) =>
              idx === index
                ? {
                  ...state,
                  uploaded: files[index]?.size ?? state.size,
                  status: 'completed',
                }
                : state
            )
          )
        },
        onFileError: (_, index) => {
          setFileStates((states) =>
            states.map((state, idx) =>
              idx === index
                ? {
                  ...state,
                  status: 'error',
                }
                : state
            )
          )
        },
      })

      setTotalProgress(95)
      if (uploaded.length > 0) {
        await api.edit.editAddFlags(
          numId,
          numCId,
          uploaded.map((f, idx) => ({
            flag: files[idx].name,
            attachmentType: FileType.Local,
            fileHash: f.hash,
          }))
        )

        setTotalProgress(100)
        showNotification({
          color: 'teal',
          message: t('admin.notification.games.challenges.attachment.updated'),
          icon: <Icon path={mdiCheck} size={1} />,
        })
        setFiles([])
        setFileStates([])
        setTotalProgress(0)
        mutate()
        props.onClose()
      }
    } catch (err) {
      setTotalProgress(0)
      setFileStates((states) =>
        states.map((state) => ({
          ...state,
          status: 'error',
        }))
      )
      showErrorMsg(err, t)
    } finally {
      setDisabled(false)
    }
  }

  return (
    <Modal {...props}>
      <Stack>
        <Text size="sm">
          {t('admin.content.games.challenges.attachment.instruction.dynamic.content')}
          <br />
          <Text fw="bold" span>
            {t('admin.content.games.challenges.attachment.instruction.dynamic.format')}
          </Text>
          <br />
          <Text fw="bold" c="orange" span>
            {t('admin.content.games.challenges.attachment.instruction.amount_double')}
          </Text>
          <br />
        </Text>
        <ScrollArea offsetScrollbars h="40vh" pos="relative">
          {files.length === 0 ? (
            <>
              <Overlay opacity={0.3} color={colorScheme === 'dark' ? 'black' : 'white'} />
              <Center h="calc(40vh - 20px)">
                <Stack gap={0}>
                  <Title order={2}>{t('admin.placeholder.games.challenges.attachment.no_file_selected.title')}</Title>
                  <Text>{t('admin.placeholder.games.challenges.attachment.no_file_selected.comment')}</Text>
                </Stack>
              </Center>
            </>
          ) : (
            <Stack gap="xs">
              {files.map((file, index) => {
                const state = fileStates[index] ?? {
                  name: file.name,
                  size: file.size,
                  uploaded: 0,
                  status: 'pending' as FileUploadStatus,
                }
                const uploadTotal = state.size || file.size || 0
                const uploadedBytes = Math.min(state.uploaded, uploadTotal)
                const progressPercent = uploadTotal === 0 ? 0 : Math.min(100, (uploadedBytes / uploadTotal) * 100)
                const status = state.status

                return (
                  <Card key={`${file.name}-${index}`} p="md" radius="md" withBorder className={uploadClasses.fileCard}>
                    <Stack gap={6}>
                      <Group justify="space-between" align="flex-start">
                        <Stack gap={2} className={uploadClasses.fileMeta}>
                          <Text lineClamp={1} ff="monospace" fw={500}>
                            {file.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {HunamizeSize(uploadedBytes)} / {HunamizeSize(uploadTotal)} · {Math.round(progressPercent)}%
                          </Text>
                        </Stack>
                        <Group gap="xs" align="center">
                          <ThemeIcon size="md" radius="xl" color={statusColorMap[status]} variant="light">
                            <Icon path={statusIconMap[status]} size={0.9} />
                          </ThemeIcon>
                          <Text size="xs" fw={500} c={statusColorMap[status]}>
                            {statusLabels[status]}
                          </Text>
                          <ActionIcon
                            onClick={() => handleRemoveFile(index)}
                            disabled={disabled || status === 'uploading'}
                            variant="subtle"
                            aria-label={t('common.modal.delete')}
                          >
                            <Icon path={mdiClose} size={1} />
                          </ActionIcon>
                        </Group>
                      </Group>
                      <Progress
                        value={progressPercent}
                        radius="sm"
                        size="sm"
                        color={statusColorMap[status]}
                        className={uploadClasses.itemProgress}
                        striped={status === 'uploading'}
                        animated={status === 'uploading'}
                      />
                    </Stack>
                  </Card>
                )
              })}
            </Stack>
          )}
        </ScrollArea>
        <Group grow>
          <FileButton multiple onChange={handleSelectFiles}>
            {(props) => (
              <Button {...props} disabled={disabled}>
                {t('common.button.select_file')}
              </Button>
            )}
          </FileButton>
          <Button
            className={uploadClasses.button}
            disabled={disabled || files.length < 1}
            onClick={onUpload}
            color={totalProgress > 0 ? 'cyan' : theme.primaryColor}
          >
            <div className={uploadClasses.label}>
              {totalProgress > 0 ? t('common.button.uploading') : t('admin.button.challenges.flag.add.dynamic')}
            </div>
            {totalProgress > 0 && (
              <Progress
                value={totalProgress}
                className={uploadClasses.progress}
                color={alpha(theme.colors[theme.primaryColor][2], 0.35)}
                radius="sm"
              />
            )}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
