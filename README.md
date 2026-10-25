# KRUSTY 冷态完整三维几何 · 在线版

这是 `KRUSTY_3D.html` 的 GitHub Pages 部署包：任何人用手机或电脑浏览器打开链接即可查看，无需安装任何软件。

- 入口文件：`index.html`（即原 `KRUSTY_3D.html`，25.6 MB，全部几何数据内嵌，零外部依赖、零 CDN 请求）
- 许可：`Anatomy_LICENSE.txt`（wheresryan22/anatomy，MIT）
- 说明：`使用说明.md`

## 部署后地址

```
https://e80985323-web.github.io/krusty-3d/
```

（仓库名改了就把 `krusty-3d` 换成对应名字；若仓库命名为 `e80985323-web.github.io`，地址就是 `https://e80985323-web.github.io/`。）

## 部署步骤

前提：仓库必须是 **Public**（GitHub 免费账号的 Pages 只对公开仓库开放）。

因为 `index.html` 有 25.6 MB，超过网页拖拽上传约 25 MB 的单文件上限，**必须用 Git 命令行或 GitHub Desktop 推送**。

```powershell
cd "C:\Users\20564\OneDrive\文档\deepseek-harness\default-workspace\krusty-3d-pages"
git init -b main
git add .
git commit -m "KRUSTY 3D geometry viewer"
git remote add origin https://github.com/e80985323-web/krusty-3d.git
git push -u origin main
```

推送时会要求认证：用户名填 `e80985323-web`，密码填 **Personal Access Token**（GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens，勾选该仓库的 Contents: Read and write）。

然后在仓库页面 **Settings → Pages**：

- Source 选 `Deploy from a branch`
- Branch 选 `main`，目录选 `/ (root)`
- 保存后等 1–2 分钟，访问上面的地址

## 更新内容

改完 `index.html` 后：

```powershell
git add .
git commit -m "update"
git push
```

Pages 会自动重新发布（约 1 分钟）。

## 注意事项

- 首次加载约 14.5 MB（GitHub Pages 自动 gzip），4G 网络约 10–20 秒，建议手机端等待时不要刷新。
- GitHub Pages 在中国大陆访问不稳定，可能很慢或打不开。面向国内用户时建议同步部署到 Cloudflare Pages（免费、可绑自己的域名）或国内对象存储静态网站，也可以额外用 jsDelivr 镜像：
  `https://cdn.jsdelivr.net/gh/e80985323-web/krusty-3d@main/index.html`
- 公开仓库意味着文件对所有人可见；发布前确认内容不含不宜公开的资料。
- GitHub Pages 免费额度：站点 ≤ 1 GB，每月约 100 GB 流量（按 14.5 MB/次算，约 7000 次访问/月）。
