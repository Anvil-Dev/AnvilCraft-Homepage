// https://vitepress.dev/guide/custom-theme
import {h} from 'vue'
import type {Theme} from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import './style.css'
// @ts-ignore
import Fullres from "./components/fullres.vue";
// @ts-ignore
import UserMenu from "./components/user-menu.vue";

export default {
    extends: DefaultTheme,
    Layout: () => {
        return h(DefaultTheme.Layout, null, {
            // https://vitepress.dev/guide/extending-default-theme#layout-slots
            'nav-bar-content-after': () => h(UserMenu),
        })
    },
    // @ts-ignore
    enhanceApp({app, router, siteData}) {
        app.component('fullres', Fullres)
    }
} satisfies Theme
