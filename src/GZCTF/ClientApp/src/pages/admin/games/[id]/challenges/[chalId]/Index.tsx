import {
  Button,
  ComboboxItem,
  Grid,
  Group,
  Input,
  NumberInput,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { DatePickerInput, TimeInput } from '@mantine/dates'
import { useModals } from '@mantine/modals'
import { showNotification } from '@mantine/notifications'
import { mdiCheck, mdiContentSaveOutline, mdiDatabaseEditOutline, mdiDeleteOutline, mdiEyeOutline } from '@mdi/js'
import { Icon } from '@mdi/react'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { HintList } from '@Components/HintList'
import { InstanceEntry } from '@Components/InstanceEntry'
import { ChallengePreviewModal } from '@Components/admin/ChallengePreviewModal'
import { SwitchLabel } from '@Components/admin/SwitchLabel'
import { WithChallengeEdit } from '@Components/admin/WithChallengeEdit'
import { ScoreFunc } from '@Components/charts/ScoreFunc'
import { showErrorMsg } from '@Utils/Shared'
import {
  ChallengeCategoryItem,
  useChallengeCategoryLabelMap,
  ChallengeTypeItem,
  useChallengeTypeLabelMap,
  ChallengeCategoryList,
} from '@Utils/Shared'
import { useEditChallenge, useEditChallenges } from '@Hooks/useEdit'
import { useGame } from '@Hooks/useGame'
import api, { ChallengeCategory, ChallengeType, ChallengeUpdateModel } from '@Api'
import misc from '@Styles/Misc.module.css'
import dayjs from 'dayjs'

const GameChallengeEdit: FC = () => {
  const navigate = useNavigate()
  const { id, chalId } = useParams()
  const [numId, numCId] = [parseInt(id ?? '-1'), parseInt(chalId ?? '-1')]

  const { game } = useGame(numId)
  const { challenge, mutate } = useEditChallenge(numId, numCId)
  const { challenges, mutate: mutateChals } = useEditChallenges(numId)

  const [challengeInfo, setChallengeInfo] = useState<ChallengeUpdateModel>({ ...challenge })
  const [disabled, setDisabled] = useState(false)

  const [minRate, setMinRate] = useState((challenge?.minScoreRate ?? 0.25) * 100)
  const [category, setCategory] = useState<string | null>(challenge?.category ?? ChallengeCategory.Misc)
  const [type, setType] = useState<string | null>(challenge?.type ?? ChallengeType.StaticAttachment)
  const [currentAcceptCount, setCurrentAcceptCount] = useState(0)
  const [previewOpened, setPreviewOpened] = useState(false)
  const [scoreFreezeEnabled, setScoreFreezeEnabled] = useState<boolean>(Boolean(challenge?.scoreFreezeTimeUtc))
  const [scoreFreezeTime, setScoreFreezeTime] = useState<dayjs.Dayjs | null>(
    challenge?.scoreFreezeTimeUtc ? dayjs(challenge.scoreFreezeTimeUtc) : null
  )

  const modals = useModals()
  const challengeTypeLabelMap = useChallengeTypeLabelMap()
  const challengeCategoryLabelMap = useChallengeCategoryLabelMap()

  const { t } = useTranslation()

  useEffect(() => {
    if (challenge) {
      setChallengeInfo({ ...challenge, clearScoreFreezeTime: undefined })
      setCategory(challenge.category)
      setType(challenge.type)
      setMinRate((challenge?.minScoreRate ?? 0.25) * 100)
      setCurrentAcceptCount(challenge.acceptedCount)
      setScoreFreezeEnabled(Boolean(challenge.scoreFreezeTimeUtc))
      setScoreFreezeTime(challenge.scoreFreezeTimeUtc ? dayjs(challenge.scoreFreezeTimeUtc) : null)
    }
  }, [challenge])

  const onUpdate = async (challenge: ChallengeUpdateModel, noFeedback?: boolean) => {
    if (!challenge) return
    setDisabled(true)

    try {
      const res = await api.edit.editUpdateGameChallenge(numId, numCId, {
        ...challenge,
        isEnabled: undefined,
      })
      if (!noFeedback) {
        showNotification({
          color: 'teal',
          message: t('admin.notification.games.challenges.updated'),
          icon: <Icon path={mdiCheck} size={1} />,
        })
      }
      mutate(res.data)
      mutateChals()
    } catch (e) {
      showErrorMsg(e, t)
    } finally {
      if (!noFeedback) {
        setDisabled(false)
      }
    }
  }

  const applyScoreFreezeTime = (value: dayjs.Dayjs | null, shouldClear?: boolean) => {
    setScoreFreezeTime(value)
    setChallengeInfo((prev) => {
      const next = { ...prev }
      if (value) {
        next.scoreFreezeTimeUtc = value.valueOf()
        next.clearScoreFreezeTime = false
      } else {
        next.scoreFreezeTimeUtc = undefined
        next.clearScoreFreezeTime = shouldClear ? true : undefined
      }
      return next
    })
  }

  const gameStart = game?.start ? dayjs(game.start) : null
  const gameEnd = game?.end ? dayjs(game.end) : null
  const resolveDefaultFreezeTime = () => {
    if (scoreFreezeTime) return scoreFreezeTime
    if (challenge?.scoreFreezeTimeUtc) return dayjs(challenge.scoreFreezeTimeUtc)
    if (gameEnd) return gameEnd.second(0).millisecond(0)
    if (gameStart) return gameStart.second(0).millisecond(0)
    return dayjs().second(0).millisecond(0)
  }
  const freezeOutOfRange =
    scoreFreezeEnabled &&
    scoreFreezeTime &&
    ((gameStart && scoreFreezeTime.isBefore(gameStart)) || (gameEnd && scoreFreezeTime.isAfter(gameEnd)))

  const freezeRangeError = freezeOutOfRange
    ? t('admin.content.games.challenges.score_freeze.error', {
      start: gameStart ? gameStart.format('YYYY-MM-DD HH:mm:ss') : 'N/A',
      end: gameEnd ? gameEnd.format('YYYY-MM-DD HH:mm:ss') : 'N/A',
    })
    : undefined

  const onConfirmDelete = async () => {
    setDisabled(true)

    try {
      await api.edit.editRemoveGameChallenge(numId, numCId)
      showNotification({
        color: 'teal',
        message: t('admin.notification.games.challenges.deleted'),
        icon: <Icon path={mdiCheck} size={1} />,
      })
      mutateChals(
        challenges?.filter((chal) => chal.id !== numCId),
        { revalidate: false }
      )
      navigate(`/admin/games/${id}/challenges`)
    } catch (e) {
      showErrorMsg(e, t)
    } finally {
      setDisabled(false)
    }
  }

  const onCreateTestContainer = async () => {
    // disabled by Toggle function

    try {
      const res = await api.edit.editCreateTestContainer(numId, numCId)
      showNotification({
        color: 'teal',
        message: t('admin.notification.games.instances.created'),
        icon: <Icon path={mdiCheck} size={1} />,
      })
      if (challenge) {
        mutate({ ...challenge, testContainer: res.data })
      }
    } catch (e) {
      showErrorMsg(e, t)
    } finally {
      setDisabled(false)
    }
  }

  const onDestroyTestContainer = async () => {
    // disabled by Toggle function

    try {
      await api.edit.editDestroyTestContainer(numId, numCId)
      showNotification({
        color: 'teal',
        message: t('admin.notification.games.instances.deleted'),
        icon: <Icon path={mdiCheck} size={1} />,
      })
      if (challenge) {
        mutate({ ...challenge, testContainer: undefined })
      }
    } catch (e) {
      showErrorMsg(e, t)
    } finally {
      setDisabled(false)
    }
  }

  const onToggleTestContainer = async () => {
    if (!challenge) return
    setDisabled(true)

    await onUpdate(
      {
        ...challengeInfo,
        category: category as ChallengeCategory,
        minScoreRate: minRate / 100,
      },
      true
    )

    if (challenge?.testContainer) {
      await onDestroyTestContainer()
    } else {
      await onCreateTestContainer()
    }
  }

  const tryDefault: <T>(values: T[], defaultValue?: NonNullable<T>) => NonNullable<T> | undefined = (vs, d) => {
    return vs.find((v) => !!v) ?? d
  }

  return (
    <WithChallengeEdit
      isLoading={!challenge}
      headProps={{ justify: 'apart' }}
      backUrl={`/admin/games/${id}/challenges`}
      head={
        <>
          <Title lineClamp={1} className={misc.wordBreakAll}>
            # {challengeInfo?.title}
          </Title>
          <Group wrap="nowrap" justify="right">
            <Button
              disabled={disabled}
              color="red"
              leftSection={<Icon path={mdiDeleteOutline} size={1} />}
              variant="outline"
              onClick={() =>
                modals.openConfirmModal({
                  title: t('admin.button.challenges.delete'),
                  children: (
                    <Text size="sm">
                      {t('admin.content.games.challenges.delete', {
                        name: challengeInfo?.title,
                      })}
                    </Text>
                  ),
                  onConfirm: () => onConfirmDelete(),
                  confirmProps: { color: 'red' },
                })
              }
            >
              {t('admin.button.challenges.delete')}
            </Button>
            <Button
              disabled={disabled}
              leftSection={<Icon path={mdiEyeOutline} size={1} />}
              onClick={() => setPreviewOpened(true)}
            >
              {t('admin.button.challenges.preview')}
            </Button>
            <Button
              disabled={disabled}
              component={Link}
              leftSection={<Icon path={mdiDatabaseEditOutline} size={1} />}
              to={`/admin/games/${numId}/challenges/${numCId}/flags`}
            >
              {t('admin.button.challenges.edit_more')}
            </Button>
            <Button
              disabled={disabled}
              leftSection={<Icon path={mdiContentSaveOutline} size={1} />}
              onClick={() =>
                onUpdate({
                  ...challengeInfo,
                  category: category as ChallengeCategory,
                  minScoreRate: minRate / 100,
                })
              }
            >
              {t('admin.button.save')}
            </Button>
          </Group>
        </>
      }
    >
      <Stack>
        <Grid columns={4}>
          <Grid.Col span={1}>
            <TextInput
              label={t('admin.content.games.challenges.title')}
              disabled={disabled}
              value={challengeInfo.title ?? ''}
              required
              onChange={(e) => setChallengeInfo({ ...challengeInfo, title: e.target.value })}
            />
          </Grid.Col>
          <Grid.Col span={1}>
            <Select
              label={
                <Group gap="sm" wrap="nowrap">
                  <Text size="sm">{t('admin.content.games.challenges.type.label')}</Text>
                  <Text size="xs" c="dimmed">
                    {t('admin.content.games.challenges.type.description')}
                  </Text>
                </Group>
              }
              placeholder="Type"
              value={type}
              disabled={disabled}
              readOnly
              renderOption={ChallengeTypeItem}
              data={Object.entries(ChallengeType).map((type) => {
                const data = challengeTypeLabelMap.get(type[1])
                return { value: type[1], label: data?.name, ...data } as ComboboxItem
              })}
            />
          </Grid.Col>
          <Grid.Col span={1}>
            <Select
              required
              label={t('admin.content.games.challenges.category')}
              placeholder="Category"
              value={category}
              disabled={disabled}
              onChange={(e) => {
                setCategory(e)
                setChallengeInfo({ ...challengeInfo, category: e as ChallengeCategory })
              }}
              renderOption={ChallengeCategoryItem}
              data={ChallengeCategoryList.map((category) => {
                const data = challengeCategoryLabelMap.get(category)
                return { value: category, label: data?.name, ...data } as ComboboxItem
              })}
            />
          </Grid.Col>
          <Grid.Col span={1}>
            <NumberInput
              label={
                <Group gap="sm" wrap="nowrap">
                  <Text size="sm">{t('admin.content.games.challenges.submission_limit.label')}</Text>
                  <Text size="xs" c="dimmed">
                    {t('admin.content.games.challenges.submission_limit.description')}
                  </Text>
                </Group>
              }
              placeholder={t('admin.content.games.challenges.submission_limit.placeholder')}
              min={0}
              max={10000}
              disabled={disabled}
              stepHoldDelay={500}
              stepHoldInterval={(t) => Math.max(1000 / t ** 2, 25)}
              value={challengeInfo?.submissionLimit || undefined}
              onChange={(e) => {
                if (typeof e === 'number') {
                  setChallengeInfo({ ...challengeInfo, submissionLimit: e })
                } else if (e === '') {
                  setChallengeInfo({ ...challengeInfo, submissionLimit: 0 })
                }
              }}
            />
          </Grid.Col>
          <Grid.Col span={2}>
            <Stack gap="xs">
              <Switch
                disabled={disabled}
                checked={scoreFreezeEnabled}
                label={SwitchLabel(
                  t('admin.content.games.challenges.score_freeze.label'),
                  t('admin.content.games.challenges.score_freeze.description')
                )}
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  setScoreFreezeEnabled(checked)
                  if (checked) {
                    applyScoreFreezeTime(resolveDefaultFreezeTime(), false)
                  } else {
                    applyScoreFreezeTime(null, true)
                  }
                }}
              />
              {scoreFreezeEnabled && (
                <Group align="flex-end" gap="sm" wrap="wrap" grow>
                  <DatePickerInput
                    flex={1}
                    label={t('admin.content.games.challenges.score_freeze.date')}
                    size="sm"
                    disabled={disabled || !scoreFreezeEnabled}
                    value={scoreFreezeTime?.toDate() ?? null}
                    minDate={gameStart?.toDate()}
                    maxDate={gameEnd?.toDate()}
                    clearable={false}
                    onChange={(value) => {
                      if (!value) return
                      const base = scoreFreezeTime ?? resolveDefaultFreezeTime()
                      const updated = dayjs(value)
                        .hour(base.hour())
                        .minute(base.minute())
                        .second(base.second())
                        .millisecond(0)
                      applyScoreFreezeTime(updated)
                    }}
                    error={freezeRangeError}
                  />
                  <TimeInput
                    label={t('admin.content.games.challenges.score_freeze.time')}
                    disabled={disabled || !scoreFreezeEnabled}
                    value={scoreFreezeTime?.format('HH:mm:ss') ?? '00:00:00'}
                    withSeconds
                    onChange={(event) => {
                      const newTime = event.currentTarget.value.split(':')
                      if (newTime.length < 2) return
                      const hours = Number(newTime[0]) || 0
                      const minutes = Number(newTime[1]) || 0
                      const seconds = newTime.length > 2 ? Number(newTime[2]) || 0 : 0
                      const base = scoreFreezeTime ?? resolveDefaultFreezeTime()
                      const updated = base.hour(hours).minute(minutes).second(seconds).millisecond(0)
                      applyScoreFreezeTime(updated)
                    }}
                    error={freezeRangeError}
                  />
                </Group>
              )}
              {scoreFreezeEnabled && (gameStart || gameEnd) && (
                <Text size="xs" c="dimmed">
                  {t('admin.content.games.challenges.score_freeze.range', {
                    start: gameStart ? gameStart.format('YYYY-MM-DD HH:mm:ss') : 'N/A',
                    end: gameEnd ? gameEnd.format('YYYY-MM-DD HH:mm:ss') : 'N/A',
                  })}
                </Text>
              )}
            </Stack>
          </Grid.Col>
        </Grid>
        <Grid columns={3}>
          <Grid.Col span={3}>
            <Textarea
              w="100%"
              label={
                <Group gap="sm">
                  <Text size="sm">{t('admin.content.games.challenges.description')}</Text>
                  <Text size="xs" c="dimmed">
                    {t('admin.content.markdown_support')}
                  </Text>
                </Group>
              }
              value={challengeInfo?.content ?? ''}
              autosize
              disabled={disabled}
              minRows={5}
              maxRows={5}
              onChange={(e) => setChallengeInfo({ ...challengeInfo, content: e.target.value })}
            />
          </Grid.Col>
          <Grid.Col span={1}>
            <Stack gap="sm">
              <HintList
                label={
                  <Group gap="sm">
                    <Text size="sm">{t('admin.content.games.challenges.hints')}</Text>
                    <Text size="xs" c="dimmed">
                      {t('admin.content.markdown_inline_support')}
                    </Text>
                  </Group>
                }
                hints={challengeInfo?.hints ?? []}
                disabled={disabled}
                height={180}
                onChangeHint={(hints) => setChallengeInfo({ ...challengeInfo, hints })}
              />
            </Stack>
          </Grid.Col>
          <Grid.Col span={1}>
            <Stack h="100%">
              <Group wrap="nowrap">
                <NumberInput
                  label={t('admin.content.games.challenges.score')}
                  min={0}
                  required
                  disabled={disabled}
                  stepHoldDelay={500}
                  stepHoldInterval={(t) => Math.max(1000 / t ** 2, 25)}
                  value={challengeInfo?.originalScore ?? 500}
                  onChange={(e) => typeof e !== 'string' && setChallengeInfo({ ...challengeInfo, originalScore: e })}
                />
                <NumberInput
                  label={t('admin.content.games.challenges.difficulty')}
                  decimalScale={2}
                  fixedDecimalScale
                  step={0.2}
                  min={0.1}
                  required
                  disabled={disabled}
                  value={challengeInfo?.difficulty ?? 100}
                  stepHoldDelay={500}
                  stepHoldInterval={(t) => Math.max(1000 / t ** 2, 25)}
                  onChange={(e) => typeof e !== 'string' && setChallengeInfo({ ...challengeInfo, difficulty: e })}
                />
              </Group>
              <Input.Wrapper label={t('admin.content.games.challenges.min_score_radio.label')} h="3.8rem" required>
                <Slider
                  label={(value) =>
                    t('admin.content.games.challenges.min_score_radio.description', {
                      min_score: ((value / 100) * (challengeInfo?.originalScore ?? 500)).toFixed(0),
                    })
                  }
                  disabled={disabled}
                  value={minRate}
                  marks={[
                    { value: 20, label: '20%' },
                    { value: 50, label: '50%' },
                    { value: 80, label: '80%' },
                  ]}
                  onChange={setMinRate}
                  classNames={{ label: misc.challEditLabel }}
                />
              </Input.Wrapper>
              <Switch
                disabled={disabled}
                checked={!challengeInfo?.disableBloodBonus}
                label={SwitchLabel(
                  t('admin.content.games.challenges.blood_bonus.label'),
                  t('admin.content.games.challenges.blood_bonus.description')
                )}
                onChange={(e) => setChallengeInfo({ ...challengeInfo, disableBloodBonus: !e.target.checked })}
              />
            </Stack>
          </Grid.Col>
          <Grid.Col span={1}>
            <ScoreFunc
              currentAcceptCount={currentAcceptCount}
              originalScore={challengeInfo.originalScore ?? 500}
              minScoreRate={minRate / 100}
              difficulty={challengeInfo.difficulty ?? 30}
            />
          </Grid.Col>
        </Grid>
        {type === ChallengeType.DynamicAttachment && (
          <TextInput
            label={t('admin.content.games.challenges.attachment_name.label')}
            description={t('admin.content.games.challenges.attachment_name.description')}
            disabled={disabled}
            value={challengeInfo.fileName ?? 'attachment'}
            onChange={(e) => setChallengeInfo({ ...challengeInfo, fileName: e.target.value })}
          />
        )}
        {(type === ChallengeType.StaticContainer || type === ChallengeType.DynamicContainer) && (
          <Grid columns={12}>
            <Grid.Col span={8}>
              <Group justify="space-between" align="flex-end">
                <TextInput
                  label={t('admin.content.games.challenges.container_image')}
                  disabled={disabled}
                  value={challengeInfo.containerImage ?? ''}
                  required
                  onChange={(e) => setChallengeInfo({ ...challengeInfo, containerImage: e.target.value })}
                  classNames={{ root: misc.flexGrow }}
                />
                <Button
                  miw="8rem"
                  color={challenge?.testContainer ? 'orange' : 'green'}
                  disabled={disabled}
                  onClick={onToggleTestContainer}
                >
                  {challenge?.testContainer
                    ? t('admin.button.challenges.test_container.destroy')
                    : t('admin.button.challenges.test_container.create')}
                </Button>
              </Group>
            </Grid.Col>
            <Grid.Col span={4}>
              <InstanceEntry
                test
                label={`${challenge?.title} @ ${game?.title} (test)`}
                disabled={disabled}
                context={{
                  closeTime: challenge?.testContainer?.expectStopAt,
                  instanceEntry: challenge?.testContainer?.entry,
                }}
              />
            </Grid.Col>
            <Grid.Col span={2}>
              <NumberInput
                label={t('admin.content.games.challenges.service_port.label')}
                description={t('admin.content.games.challenges.service_port.description')}
                min={1}
                max={65535}
                required
                disabled={disabled}
                stepHoldDelay={500}
                stepHoldInterval={(t) => Math.max(1000 / t ** 2, 25)}
                value={challengeInfo.containerExposePort ?? 1}
                onChange={(e) =>
                  typeof e !== 'string' && setChallengeInfo({ ...challengeInfo, containerExposePort: e })
                }
              />
            </Grid.Col>
            <Grid.Col span={2}>
              <NumberInput
                label={t('admin.content.games.challenges.cpu_limit.label')}
                description={t('admin.content.games.challenges.cpu_limit.description')}
                min={1}
                max={1024}
                required
                disabled={disabled}
                stepHoldDelay={500}
                stepHoldInterval={(t) => Math.max(1000 / t ** 2, 25)}
                value={challengeInfo.cpuCount ?? 1}
                onChange={(e) => typeof e !== 'string' && setChallengeInfo({ ...challengeInfo, cpuCount: e })}
              />
            </Grid.Col>
            <Grid.Col span={2}>
              <NumberInput
                label={t('admin.content.games.challenges.memory_limit.label')}
                description={t('admin.content.games.challenges.memory_limit.description')}
                min={32}
                max={1048576}
                required
                disabled={disabled}
                stepHoldDelay={500}
                stepHoldInterval={(t) => Math.max(1000 / t ** 2, 25)}
                value={challengeInfo.memoryLimit ?? 32}
                onChange={(e) => typeof e !== 'string' && setChallengeInfo({ ...challengeInfo, memoryLimit: e })}
              />
            </Grid.Col>
            <Grid.Col span={2}>
              <NumberInput
                label={t('admin.content.games.challenges.storage_limit.label')}
                description={t('admin.content.games.challenges.storage_limit.description')}
                min={128}
                max={1048576}
                required
                disabled={disabled}
                stepHoldDelay={500}
                stepHoldInterval={(t) => Math.max(1000 / t ** 2, 25)}
                value={challengeInfo.storageLimit ?? 128}
                onChange={(e) => typeof e !== 'string' && setChallengeInfo({ ...challengeInfo, storageLimit: e })}
              />
            </Grid.Col>
            <Grid.Col span={4} display="flex" className={misc.alignCenter}>
              <Switch
                disabled={disabled}
                checked={challengeInfo.enableTrafficCapture ?? false}
                label={SwitchLabel(
                  t('admin.content.games.challenges.traffic_capture.label'),
                  t('admin.content.games.challenges.traffic_capture.description')
                )}
                onChange={(e) => setChallengeInfo({ ...challengeInfo, enableTrafficCapture: e.target.checked })}
              />
            </Grid.Col>
          </Grid>
        )}
      </Stack>
      <ChallengePreviewModal
        challenge={{
          title: tryDefault([challengeInfo?.title, challenge?.title], ''),
          content: tryDefault([challengeInfo?.content, challenge?.content]),
          hints: tryDefault([challengeInfo?.hints, challenge?.hints], []),
          score: tryDefault([challengeInfo?.originalScore, challenge?.originalScore], 500),
          limit: tryDefault([challengeInfo?.submissionLimit, challenge?.submissionLimit], 0),
          category: category as ChallengeCategory,
          type: challenge?.type ?? ChallengeType.StaticAttachment,
        }}
        opened={previewOpened}
        onClose={() => setPreviewOpened(false)}
        cateData={
          challengeCategoryLabelMap.get((challengeInfo?.category as ChallengeCategory) ?? ChallengeCategory.Misc)!
        }
      />
    </WithChallengeEdit>
  )
}

export default GameChallengeEdit
