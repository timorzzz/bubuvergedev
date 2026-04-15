import AccountCircleRoundedIcon from '@mui/icons-material/AccountCircleRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import { Navigate, createBrowserRouter, RouteObject } from 'react-router'

import HomeSvg from '@/assets/image/itemicon/home.svg?react'
import SettingsSvg from '@/assets/image/itemicon/settings.svg?react'

import AccountPage from './account'
import Layout from './_layout'
import HomePage from './home'
import SettingsPage from './settings'

export const navItems = [
  {
    label: '首页',
    path: '/',
    icon: [<HomeRoundedIcon key="mui" />, <HomeSvg key="svg" />],
    Component: HomePage,
  },
  {
    label: '账户',
    path: '/account',
    icon: [
      <AccountCircleRoundedIcon key="mui" />,
      <AccountCircleRoundedIcon key="alt" />,
    ],
    Component: AccountPage,
  },
  {
    label: '设置',
    path: '/settings',
    icon: [<SettingsRoundedIcon key="mui" />, <SettingsSvg key="svg" />],
    Component: SettingsPage,
  },
]

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      ...navItems.map(
        (item) =>
          ({
            path: item.path,
            Component: item.Component,
          }) as RouteObject,
      ),
      {
        path: '/proxies',
        element: <Navigate to="/" replace />,
      },
    ],
  },
])
