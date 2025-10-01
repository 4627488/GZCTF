import {
  Box,
  Card,
  Center,
  Code,
  Divider,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
  alpha,
  useMantineTheme,
  useMantineColorScheme,
} from '@mantine/core'
import { mdiFlag, mdiSnowflake } from '@mdi/js'
import { Icon } from '@mdi/react'
import cx from 'clsx'
import dayjs from 'dayjs'
import { FC } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ScrollingText } from '@Components/ScrollingText'
import { useLanguage } from '@Utils/I18n'
import { BloodsTypes, PartialIconProps, useChallengeCategoryLabelMap } from '@Utils/Shared'
import { ChallengeInfo, SubmissionType } from '@Api'
import classes from '@Styles/ChallengeCard.module.css'
import misc from '@Styles/Misc.module.css'
import tooltipClasses from '@Styles/Tooltip.module.css'

interface ChallengeCardProps {
  challenge: ChallengeInfo
  solved?: boolean
  onClick?: () => void
  iconMap: Map<SubmissionType, PartialIconProps | undefined>
  colorMap: Map<SubmissionType, string | undefined>
  teamId?: number
  status?: SubmissionType
  frozen?: boolean
}

export const ChallengeCard: FC<ChallengeCardProps> = (props: ChallengeCardProps) => {
  const { challenge, solved, onClick, iconMap, teamId, colorMap, status, frozen } = props
  const challengeCategoryLabelMap = useChallengeCategoryLabelMap()
  const cateData = challengeCategoryLabelMap.get(challenge.category!)
  const theme = useMantineTheme()
  const { colorScheme } = useMantineColorScheme()
  const { locale } = useLanguage()
  const { t } = useTranslation()
  const solvedCount = challenge.solved ?? 0
  const frozenSolved = challenge.frozenSolved ?? 0
  const solvedDisplay = frozenSolved > 0 ? `${solvedCount} (+${frozenSolved})` : `${solvedCount}`
  const isFrozen = frozen ?? (status === SubmissionType.Late)
  const frozenAccent = theme.colors.blue[colorScheme === 'dark' ? 4 : 5]
  const frozenOverlay = alpha(frozenAccent, colorScheme === 'dark' ? 0.2 : 0.16)
  const frozenOutline = alpha(frozenAccent, colorScheme === 'dark' ? 0.6 : 0.45)
  const frozenCardStyle = isFrozen
    ? {
      outline: `1px dashed ${frozenOutline}`,
      outlineOffset: -2,
      backgroundImage: `linear-gradient(135deg, ${frozenOverlay} 0%, transparent 65%)`,
    }
    : undefined
  const frozenBadgeStyle = isFrozen
    ? {
      backgroundColor: alpha(frozenAccent, colorScheme === 'dark' ? 0.55 : 0.25),
      color: colorScheme === 'dark' ? theme.colors.blue[0] : theme.colors.blue[9],
    }
    : undefined

  return (
    <Card
      onClick={onClick}
      radius="md"
      shadow="sm"
      className={cx(misc.hoverCard, classes.root)}
      data-solved={solved || undefined}
      data-frozen={isFrozen || undefined}
      style={frozenCardStyle}
      data-no-move
    >
      <Stack gap="xs" pos="relative" style={{ zIndex: 99 }}>
        <Group h="30px" wrap="nowrap" justify="space-between" gap={2}>
          <ScrollingText text={challenge.title || ''} size="lg" />
        </Group>
        <Divider size="sm" color={cateData?.color} />
        <Group wrap="nowrap" justify="space-between" align="center" gap={2}>
          <Text ta="center" fw="bold" fz="lg" ff="monospace">
            {challenge.score}&nbsp;pts
          </Text>
          <Stack gap="xs">
            <Title order={6} ta="center" mt={`calc(${theme.spacing.xs} / 2)`}>
              <Trans
                i18nKey={'challenge.content.solved'}
                values={{
                  solved: solvedDisplay,
                }}
              >
                _
                <Code fz="sm" fw="bolder" bg="transparent">
                  _
                </Code>
                _
              </Trans>
            </Title>
            <Group justify="center" gap="md" h={20} wrap="nowrap">
              {challenge.bloods &&
                challenge.bloods.map((blood, idx) => {
                  const iconProps = iconMap.get(BloodsTypes[idx])!
                  return (
                    <Tooltip.Floating
                      key={idx}
                      position="bottom"
                      multiline
                      classNames={tooltipClasses}
                      label={
                        <Stack gap={0}>
                          <Text fw={500} size="sm">
                            {blood?.name}
                          </Text>
                          <Text fw={500} size="xs" c="dimmed">
                            {dayjs(blood?.submitTimeUtc).locale(locale).format('SLL LTS')}
                          </Text>
                        </Stack>
                      }
                    >
                      <div style={{ position: 'relative', height: 20 }}>
                        <div className={classes.blood}>
                          <Icon {...iconProps} />
                        </div>
                        <Box
                          className={classes.spike}
                          data-blood={teamId === blood?.id || undefined}
                          __vars={{
                            '--blood-color': colorMap.get(BloodsTypes[idx]),
                          }}
                        />
                      </div>
                    </Tooltip.Floating>
                  )
                })}
            </Group>
          </Stack>
        </Group>
      </Stack>
      {cateData && (
        <Icon
          size={4}
          path={cateData.icon}
          color={alpha(theme.colors[cateData?.color][7], 0.3)}
          className={classes.icon}
        />
      )}
      {solved && !isFrozen && (
        <Center className={classes.flag}>
          <Icon size={1} path={mdiFlag} />
        </Center>
      )}
      {isFrozen && (
        <Tooltip.Floating
          position="bottom"
          multiline
          classNames={tooltipClasses}
          label={
            <Stack gap={0}>
              <Text fw={500} size="sm">
                {t('game.content.legend.late')}
              </Text>
              <Text fw={500} size="xs" c="dimmed">
                {t('game.content.legend.late_descr')}
              </Text>
            </Stack>
          }
        >
          <Center className={classes.flag} data-frozen style={frozenBadgeStyle}>
            <Icon size={1} path={mdiSnowflake} />
          </Center>
        </Tooltip.Floating>
      )}
    </Card>
  )
}
