# PLANT-1 · FM-1 模块化固件（Phase Plant 复刻）

把 Kilohearts **Phase Plant** 那套「发生器 / 调制器 / 效果器」模块化思路，做成 **M-VAVE FM-1** 的样子：27 键、TFT 小屏、袖珍机身。不一样的是，这台固件跑在**浏览器**里——打开就能弹，不用刷机，也不会变砖。

- 在线试玩：**<https://kong8la.com/plant1/play/>**
- 线上站点：**<https://kong8la.com/plant1/>**（安装页 `/install/`，刷写页 `/flash/`）
- 本地：`node build.mjs` 后打开 `play/index.html`，或 `npx serve .`

## 目录

```
.
├── index.html              落地页
├── install/index.html      安装页（环境检查 / 连接 FM-1 / 安装 PWA）
├── flash/index.html        刷写页（选包 / 校验 / 连接 / 写入 / 重启验证）
├── flash/vendor/           fm1-base 体系的 OTA 协议与 .fwsc 解析（MPL-2.0）
├── play/index.html         合成器（build 产物，单文件 132 KB）
├── play/manifest.webmanifest + sw.js   离线缓存
├── assets/                 图标与截图
├── src/                    源码
│   ├── engine.js           DSP 引擎（AudioWorklet 与 ScriptProcessor 共用）
│   ├── ui.js               界面、交互、MIDI / FM-1 控制器映射
│   ├── presets.js          13 个预设
│   ├── style.css
│   └── index.html          模板
├── build.mjs               把 src 内联成 play/index.html
├── test/                   离线渲染、音质、无头浏览器验收
└── .github/workflows/pages.yml
```

## 本地跑

```bash
node build.mjs          # 生成 play/index.html
npx serve .             # 或 python -m http.server
```

`file://` 直接打开 `play/index.html` 也能出声（AudioWorklet 被禁用时自动退回 ScriptProcessor），只是没有离线缓存和 PWA 安装。

## 部署

### kong8la.com（当前线上）

站点挂在 `45.76.107.67` 的 nginx 下，路径 `/var/www/northline/plant1/`，对外 **<https://kong8la.com/plant1/>**。

```powershell
.\deploy\publish.ps1          # 构建 → 上传 → 挂 nginx（幂等）
.\deploy\publish.ps1 -NoBuild # 只上传已有产物
```

- `deploy/remote-install.sh`：服务器端全部逻辑（修权限、加 `location ^~ /plant1/`、补 `.webmanifest` MIME、`nginx -t` + reload、逐项自检）。
- 首次部署会备份原 nginx 配置到 `/root/northline.<时间戳>.bak`，并给 `.webmanifest` 补 `application/manifest+json`。
- 线上验收：`node test/live.mjs`（四个页面 + AudioWorklet 出声 + SW 作用域 + 控制台错误）。

### GitHub Pages（备用）

1. 建仓库并推送（见下）。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
3. 推一个 commit 到 `main`，工作流会自动 `node build.mjs` 并把 `index.html / install / play / flash / assets` 发布出去。

推送命令：

```bash
git init -b main
git add -A
git commit -m "PLANT-1: Phase Plant 复刻，FM-1 主题单文件合成器"
git remote add origin git@github.com:<你的账号>/plant1.git
git push -u origin main
```

## 操作

| 操作 | 效果 |
| --- | --- |
| 点击 / 拖动键盘 | 演奏（27 键） |
| `Z–M` / `Q–U` | 两排电脑键盘 |
| `↑` `↓` | 换八度 |
| 拖 `ENV1` / `LFO1` / `CHAOS` / `MACRO` 标签到旋钮 | 建立调制 |
| 拖旋钮 / `Shift` | 改值 / 精调 |
| `Alt` + 拖已接线旋钮 | 调调制深度 |
| 双击 / 右键旋钮 | 复位 / 清除该参数调制 |

## 刷写真机固件（.fwsc）

`/flash/` 是**真刷机页**：走 FM-1 自己的 USB-MIDI 升级协议（M-UPGRADE 兼容），不是演示动画。

1. 选一个 `.fwsc` 固件包（Golf、Zombie、fm1-dock、OG Synth 或你自己用 fm1-base 打的包）。页面会解析包身份
   （如 `FM-1_63002101`）、逻辑镜像长度、SHA-256，并确认里面有 `FELUCCA-LOADER-1`。
2. 点「连接 FM-1」授权 Web MIDI，页面用身份查询（不靠端口名）确认设备。
3. 勾选确认后写入：设备先进入更新模式、读取镜像，再重启进加载器、整片写入，最后自报身份校验。

中断不会变砖：设备会停在更新加载器（身份 `ota-FM-1`），插回线再点写入即续传。
恢复原厂固件用 M-VAVE 自己的 M-UPGRADE。

> PLANT-1 自己不在这套 `.fwsc` 体系里——它是浏览器固件，装机见 `/install/`。
> 这一页刷的是真机固件包，二者互不影响。

协议与包解析来自
[zombie-fm1-web](https://github.com/Joolo09/zombie-fm1-web) /
[fm1-base](https://github.com/charlesvestal/fm1-base)，按 **MPL-2.0** 使用，
见 [`flash/vendor/README.md`](flash/vendor/README.md) 与 [`flash/LICENSES/MPL-2.0.md`](flash/LICENSES/MPL-2.0.md)。

## 接上 FM-1

安装页里点「连接 FM-1」授权 Web MIDI，合成器会自动认到设备（TFT 行显示 `FM-1 · N V`），并把硬件映射进来：

- 27 键：Note On/Off（note 53–79）
- 7 个旋钮：CC 20–26 → 全局滤波截止/共振、G1 截止/共振、宏控、总音量、FX3 混音（相对编码器，值 64 为中心）
- 14 个按键：CC 40–53 → 上一个/下一个音色、静音、保持、初始化、随机、试听、全局滤波开关、FX1–FX5 开关

## 引擎

- **4 个发生器槽**：模拟（polyBLEP 抗混叠）、波表（2 帧形变 + 6 级 mip）、FM 算子、噪声
- **调制器**：3 × ADSR、2 × LFO（可同步）、混沌、宏控；每声部独立，复音不串
- **调制矩阵**：任意源 → 任意浮点参数，±100%
- **滤波**：每发生器 TPT SVF + 全局 SVF（截止/共振/过载）
- **效果链**：5 槽，驱动 / 降位 / 合唱 / 移相 / 延迟 / 混响 / 均衡 / 压缩 / 滤波 / 立体声
- **主输出**：tanh 软限幅 + 硬兜底 + DC 阻断，换音色/静音有淡入淡出

## 测试

```bash
node test/check.mjs     # 13 预设离线渲染：峰值/静音/NaN/音高
node test/check2.mjs    # 立体声宽度、LFO 调制、复音上限、panic 清尾音
node test/quality.mjs   # 直流、起音/释音爆音、释音残余
node test/headless.mjs  # 无头 Chrome：file:// + http:// 两条音频链路、SW、落地页/安装页
```

## 说明

这是对 Phase Plant **交互与架构理念**的复刻（模块化槽位 + 拖拽调制 + 半模块化信号流），不是对它的 DSP 二进制或音色的逐点仿真；也没有使用 Kilohearts 或 M-VAVE 的代码与素材。PLANT-1 不写入 FM-1 的 flash。想刷真机固件请用 [fm1-base](https://github.com/charlesvestal/fm1-base) 的 `.fwsc` 工具链或社区固件（Golf、fm1-dock、OG Synth）。

## License

MIT
