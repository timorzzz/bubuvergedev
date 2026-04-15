import { MenuItem, Select } from '@mui/material'
import { useTranslation } from 'react-i18next'

import { useVerge } from '@/hooks/use-verge'
import getSystem from '@/utils/get-system'

import { GuardState } from './mods/guard-state'
import { SettingItem, SettingList } from './mods/setting-comp'

interface Props {
  onError?: (err: Error) => void
}

const OS = getSystem()

const SettingVergeBasic = ({ onError }: Props) => {
  const { t } = useTranslation()
  const { verge, patchVerge, mutateVerge } = useVerge()
  const { tray_event } = verge ?? {}

  const onChangeData = (patch: any) => {
    mutateVerge({ ...verge, ...patch }, false)
  }

  return (
    <SettingList title={t('settings.components.verge.basic.title')}>
      {OS !== 'linux' && (
        <SettingItem label={t('settings.components.verge.basic.fields.trayClickEvent')}>
          <GuardState
            value={tray_event ?? 'main_window'}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={(e) => onChangeData({ tray_event: e })}
            onGuard={(e) => patchVerge({ tray_event: e })}
          >
            <Select size="small" sx={{ width: 140, '> div': { py: '7.5px' } }}>
              <MenuItem value="main_window">
                {t('settings.components.verge.basic.trayOptions.showMainWindow')}
              </MenuItem>
              <MenuItem value="tray_menu">
                {t('settings.components.verge.basic.trayOptions.showTrayMenu')}
              </MenuItem>
              <MenuItem value="system_proxy">
                {t('settings.sections.system.toggles.systemProxy')}
              </MenuItem>
              <MenuItem value="tun_mode">
                {t('settings.sections.system.toggles.tunMode')}
              </MenuItem>
              <MenuItem value="disable">
                {t('settings.components.verge.basic.trayOptions.disable')}
              </MenuItem>
            </Select>
          </GuardState>
        </SettingItem>
      )}
    </SettingList>
  )
}

export default SettingVergeBasic
