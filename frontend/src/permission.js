import router from '@/router'
import store from './store'
// import { Message } from 'element-ui'
import NProgress from 'nprogress' // progress bar
import 'nprogress/nprogress.css' // progress bar style
import {
  getToken
} from '@/utils/auth' // get token from cookie
import getPageTitle from '@/utils/get-page-title'
import {
  buildMenus
} from '@/api/system/menu'
import {
  filterAsyncRouter
} from '@/store/modules/permission'
import {
  isMobile,
  changeFavicon
} from '@/utils/index'
import Layout from '@/layout/index'
import { getSysUI } from '@/utils/auth'

import { getSocket } from '@/websocket'

NProgress.configure({
  showSpinner: false
}) // NProgress Configuration

const whiteList = ['/login', '/401', '/404', '/delink', '/nolic', '/de-auto-login'] // no redirect whitelist

const routeBefore = (callBack) => {
  let uiInfo = getSysUI()
  if (!uiInfo || Object.keys(uiInfo).length === 0) {
    store.dispatch('user/getUI').then(() => {
      document.title = getPageTitle()
      uiInfo = getSysUI()
      if (uiInfo['ui.favicon'] && uiInfo['ui.favicon'].paramValue) {
        const faviconUrl = '/system/ui/image/' + uiInfo['ui.favicon'].paramValue
        changeFavicon(faviconUrl)
      }
      callBack()
    }).catch(err => {
      document.title = getPageTitle()
      console.error(err)
      callBack()
    })
  } else {
    document.title = getPageTitle()
    if (!!uiInfo && uiInfo['ui.favicon'] && uiInfo['ui.favicon'].paramValue) {
      const faviconUrl = '/system/ui/image/' + uiInfo['ui.favicon'].paramValue
      changeFavicon(faviconUrl)
    }
    callBack()
  }
}
router.beforeEach(async(to, from, next) => routeBefore(() => {
  // start progress bar
  NProgress.start()
  const mobileIgnores = ['/delink']
  const mobilePreview = '/preview/'

  if (isMobile() && !to.path.includes(mobilePreview) && mobileIgnores.indexOf(to.path) === -1) {
    window.location.href = window.origin + '/app.html'
    NProgress.done()
  }

  // set page title
  document.title = getPageTitle(to.meta.title)

  // determine whether the user has logged in
  const hasToken = getToken()
  if (hasToken) {
    if (to.path === '/login') {
      // if is logged in, redirect to the home page
      next({
        path: '/'
      })
      NProgress.done()
    } else {
      const hasGetUserInfo = store.getters.name
      if (hasGetUserInfo || to.path.indexOf('/previewScreenShot/') > -1 || to.path.indexOf('/preview/') > -1 || to.path.indexOf('/delink') > -1 || to.path.indexOf('/nolic') > -1) {
        next()
        store.dispatch('permission/setCurrentPath', to.path)
      } else {
        if (store.getters.roles.length === 0) { // ????????????????????????????????????user_info??????
          // get user info
          store.dispatch('user/getInfo').then(() => {
            const deWebsocket = getSocket()
            deWebsocket && deWebsocket.reconnect && deWebsocket.reconnect()
            store.dispatch('lic/getLicInfo').then(() => {
              loadMenus(next, to)
            }).catch(() => {
              loadMenus(next, to)
            })
          }).catch(() => {
            store.dispatch('user/logout').then(() => {
              location.reload() // ?????????????????????vue-router?????? ??????bug
            })
          })
        } else if (store.getters.loadMenus) {
          // ?????????false??????????????????
          store.dispatch('user/updateLoadMenus')
          store.dispatch('lic/getLicInfo').then(() => {
            loadMenus(next, to)
          }).catch(() => {
            loadMenus(next, to)
          })
        } else {
          next()
        }
      }
    }
  } else {
    /* has no token*/

    if (whiteList.indexOf(to.path) !== -1) {
      // in the free login whitelist, go directly
      next()
    } else {
      // other pages that do not have permission to access are redirected to the login page.
      // next(`/login?redirect=${to.path}`)
      next('/login')
      NProgress.done()
    }
  }
}))
export const loadMenus = (next, to) => {
  buildMenus().then(res => {
    const data = res.data
    const filterData = filterRouter(data)
    const asyncRouter = filterAsyncRouter(filterData)
    // ?????????????????? ?????????????????? ?????? ????????????????????????????????????
    if (JSON.stringify(data).indexOf('wizard') > -1) {
      asyncRouter.push({
        path: '/',
        component: Layout,
        redirect: '/wizard/index',
        hidden: true
      })
    } else {
      asyncRouter.push({
        path: '/',
        component: Layout,
        redirect: '/panel/index',
        hidden: true
      })
    }

    asyncRouter.push({
      path: '*',
      redirect: '/404',
      hidden: true
    })
    store.dispatch('permission/GenerateRoutes', asyncRouter).then(() => { // ????????????
      router.addRoutes(asyncRouter)
      if (pathValid(to.path, asyncRouter)) {
        next({
          ...to,
          replace: true
        })
      } else {
        next('/')
      }
    })
  })
}

/**
 * ??????path????????????
 * @param {*} path
 * @param {*} routers
 * @returns
 */
const pathValid = (path, routers) => {
  const temp = path.startsWith('/') ? path.substr(1) : path
  const locations = temp.split('/')
  if (locations.length === 0) {
    return false
  }

  return hasCurrentRouter(locations, routers, 0)
}
/**
 * ????????????every level
 * @param {*} locations
 * @param {*} routers
 * @param {*} index
 * @returns
 */
const hasCurrentRouter = (locations, routers, index) => {
  const location = locations[index]
  let kids = []
  const isvalid = routers.some(router => {
    kids = router.children
    return (router.path === location || ('/' + location) === router.path)
  })
  if (isvalid && index < locations.length - 1) {
    return hasCurrentRouter(locations, kids, index + 1)
  }
  return isvalid
}
// ????????????????????????
const filterRouter = routers => {
  const user_permissions = store.getters.permissions
  // if (!user_permissions || user_permissions.length === 0) {
  //   return routers
  // }
  const tempResults = routers.filter(router => hasPermission(router, user_permissions))
  // ?????????????????????(??????) ??????????????? ????????????
  return tempResults.filter(item => {
    if (item.type === 0 && (!item.children || item.children.length === 0)) {
      return false
    }
    return true
  })
}
const hasPermission = (router, user_permissions) => {
  // ??????????????????????????? eg. user:read,user:delete
  if (router.permission && router.permission.indexOf(',') > -1) {
    const permissions = router.permission.split(',')
    const permissionsFilter = permissions.filter(permission => {
      return user_permissions.includes(permission)
    })
    if (!permissionsFilter || permissionsFilter.length === 0) {
      return false
    }
  } else if (router.permission && !user_permissions.includes(router.permission)) {
    // ?????????????????? ????????????????????????????????????????????????
    return false
  }

  if (!filterLic(router)) {
    return false
  }
  // ?????????????????? ??? ?????????????????? ????????????????????????????????????
  if (router.children && router.children.length) {
    const permissionChildren = router.children.filter(item => hasPermission(item, user_permissions))
    router.children = permissionChildren
    return router.children.length > 0
  }
  return true
}
const filterLic = (router) => {
  return !router.isPlugin || store.getters.validate
}
router.afterEach(() => {
  // finish progress bar
  NProgress.done()
})
