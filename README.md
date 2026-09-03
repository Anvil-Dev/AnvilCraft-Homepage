# AnvilCraft-Homepage

AnvilCraft（铁砧工艺）官方网站（VitePress），内容自动扫描 `src/posts` 生成导航。

## 本地开发

```bash
pnpm install
pnpm docs:dev      # 开发预览（默认 http://localhost:5173）
pnpm docs:build    # 静态构建（输出 src/.vitepress/dist）
pnpm docs:preview  # 预览构建产物
```

## 动态页面（需要后端）

以下页面由 `anvilcraft-websites-backend` 提供数据：

- 贡献者墙 / 申请成为贡献者 / 个人中心（`src/posts/base-info/`，含英文版）

构建/运行时通过 `window.__ANVIL_API_BASE__` 指定后端地址：

```bash
# 构建期注入（推荐）
ANVIL_API_BASE=https://api.example.com pnpm docs:build

# 或在部署时于页面加载前设置
# <script>window.__ANVIL_API_BASE__ = 'https://api.example.com';</script>
```

未配置时相关页面会显示提示而非报错。

## 数据与成员维护

- `member.txt`：成员原始数据；`process.ts` 脚本负责下载头像并生成主题 JSON（需自行提供 TS 运行器）
- `src/.vitepress/theme/data/*.json`：成员/贡献者展示数据（process.ts 产物）

## License

与 [AnvilCraft](https://github.com/Anvil-Dev/AnvilCraft) 站点内容许可一致（见页面页脚）。
