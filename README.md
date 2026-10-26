# KRUSTY 冷态完整三维几何 · 在线版

`KRUSTY_3D.html` 的 GitHub Pages 部署包：任何人用手机或电脑浏览器打开链接即可查看，无需安装任何软件。

- 入口：`index.html`（0.27 MB，含全部 361 个 cell 的元数据、界面与渲染代码）
- 几何数据（按需加载，默认只用 `quarter`）：
  | 文件 | 体积 | 顶点 | 三角 | 部件 |
  | --- | --- | --- | --- | --- |
  | `data/quarter.bin.gz`（默认，四分之一剖开） | 5.07 MB | 1,896,624 | 632,208 | 348 |
  | `data/full.bin.gz`（完整外形） | 6.69 MB | 2,530,572 | 843,524 | 399 |
  | `data/half.bin.gz`（半剖） | 3.23 MB | 1,260,648 | 420,216 | 273 |
  - 每顶点 16 字节：`float32` 位置 ×3 + `int8` 法线 ×3（+1 填充字节），文件为 gzip -9
- 许可：`Anatomy_LICENSE.txt`（wheresryan22/anatomy，MIT）
- 生成/校验脚本与体积报告：`tools/`

## 直接可用地址

```
https://e80985323-web.github.io/krusty-3d/
```

## 加速改版说明（相对原单文件版）

原版把 25.6 MB 几何以 base64(zlib) 内嵌在 HTML 里：浏览器要先解析 25.6 MB 的 HTML 与 25.6 MB 的 JSON 字面量，再逐字符 `atob`，最后把 43 MB 顶点数据上传显存。带宽只是其中一部分，解析与解码才是手机上的主要卡顿来源。

现在：

- 页面 25,583,439 B → **288,299 B（0.27 MB）**
- 首屏传输（GitHub Pages）：原 15.2 MB（Pages 自动 gzip）→ **0.28 MB + 5.07 MB ≈ 5.36 MB**
- 几何改为外部文件，切换“完整外形/半剖”时才下载对应档位；法线由 `float32` 改存 `int8`（重新归一化后平均误差 0.057°、最大 0.253°，肉眼不可见）
- 保留的原始精度：顶点位置与原单文件版**逐字节一致**（`tools/check_payload.mjs` 校验三个档位 `posMismatch=0`）

验证（本机 http 回环 + 无头 Chrome）：

- 与原单文件版逐像素对比，6 组截图（四分之一 / 全堆 / 半剖切片 / 堆芯 / 深色 / 390 px 手机）最大通道差 **≤ 2/255**，肉眼不可区分
- 拾取探针（7 个采样点）与原版完全一致，无 JavaScript 异常，WebGL 错误码 0
- 4× CPU 降速（模拟较慢的手机）：首屏可见耗时 **0.81 s**，原版 **2.46 s**
- 宿主已自带 `Content-Encoding: gzip` 与需页面自行解压两条路径都实测通过（两种情形均逐像素一致）

线上实测（GitHub Pages，同一代理链路，两次测量相隔数分钟）：

| | 原单文件版 | 本改版 |
| --- | --- | --- |
| 首屏传输 | 15,197,063 B | 51,438 B（页面）+ 5,321,010 B（默认几何）= 5.37 MB |
| 页面脚本就绪 | 8.53 s | 3.41 s |
| 几何载入 + 首帧 | 8.66 s | 6.21 s |
| 4× CPU 降速下首帧（本机回环） | 2.46 s | 0.81 s |

代理链路当时只有约 9 Mbps，属于带宽瓶颈；网络越好、CPU 越弱（手机），本改版的相对优势越大。此外页面 288 KB 解析远快于 25.6 MB 内嵌 JSON，同时省掉约 25 MB 的 base64 逐字符解码与 43 MB 显存上传。

线上文件与本地构建一致（2026-10-27 核验）：`index.html` 288,371 B，`sha256 410b79f0f3526f9439c433a4677b55c0fbe34ecb5009fa1e849096efa2123d02`；`data/quarter.bin.gz` 5,321,010 B（sha256 `50f2dc67…f154`）、`full.bin.gz` 7,015,869 B、`half.bin.gz` 3,390,444 B。线上返回 `Content-Type: application/gzip` 且无 `Content-Encoding`，由页面自行解压（宿主若已带 `Content-Encoding: gzip` 也能正确处理，两条路径都有实测）。

## 本地预览

页面用 `fetch` 读取 `data/`，所以**不能双击 `index.html` 直接打开**（浏览器安全限制），需要 http 服务器：

```powershell
cd "C:\Users\20564\OneDrive\文档\deepseek-harness\default-workspace\krusty-3d-pages"
python -m http.server 8767
# 然后访问 http://127.0.0.1:8767/index.html
```

## 部署与更新

仓库是 **Public**（GitHub 免费账号的 Pages 只对公开仓库开放），发布方式为 `Deploy from a branch: main / (root)`。

```powershell
cd "C:\Users\20564\OneDrive\文档\deepseek-harness\default-workspace\krusty-3d-pages"
git add .
git commit -m "update"
git push
```

推送认证：用户名 `e80985323-web`，密码用 Personal Access Token（需 Contents: Read and write）。

重新生成页面与几何（源文件为 `KRUSTY_Anatomy_3D_20261025_01\KRUSTY_3D.html`）：

```powershell
node tools/build_fast.mjs "<源 KRUSTY_3D.html>" .
node tools/check_payload.mjs "<源 KRUSTY_3D.html>" .   # 位置逐字节一致 + int8 法线误差
```

## 注意事项

- 首次打开约 5.4 MB（0.27 MB 页面 + 5.07 MB 默认几何），4G 网络约 3–8 秒；切换“完整外形”会再取 6.69 MB。构建时优先取当前档位，页面在几何下载中会显示「载入几何… x / y MB」进度。
- GitHub Pages 在中国大陆访问不稳定，可能很慢或打不开。面向国内用户时建议同步部署到 Cloudflare Pages（免费、可绑自己的域名）或国内对象存储静态网站。
- 公开仓库意味着文件对所有人可见；发布前确认内容不含不宜公开的资料。
- GitHub Pages 免费额度：站点 ≤ 1 GB，每月约 100 GB 流量（按 5.4 MB/次算，约 18,000 次访问/月）。