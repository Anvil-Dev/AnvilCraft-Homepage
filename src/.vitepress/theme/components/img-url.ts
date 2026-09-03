// 图片 URL 工具：https 页面下把 http:// 图片 URL 升级为 https（防混合内容被浏览器拦截）。
export function upUrl(url: string): string {
  if (typeof location !== 'undefined' && location.protocol === 'https:' && url.startsWith('http://')) {
    return 'https://' + url.slice('http://'.length)
  }
  return url
}
