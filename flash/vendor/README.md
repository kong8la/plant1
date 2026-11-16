# 第三方代码（vendor）

`flash/vendor/fm1ota.js` 与 `flash/vendor/fm1pkg.js` 不是本项目原创，直接取自社区实现：

- 来源：<https://github.com/Joolo09/zombie-fm1-web>（`lab/vendor/`）
- 上游：<https://github.com/charlesvestal/fm1-base>
- 许可：**Mozilla Public License 2.0**（MPL-2.0），全文见 [`../LICENSES/MPL-2.0.md`](../LICENSES/MPL-2.0.md)
- 版权：Copyright (C) 2026 Charles Vestal；Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments

改动：只在文件头加了来源说明，逻辑未改。按 MPL-2.0 §3.1，本仓库以源码形式提供这两个文件；
如修改它们，修改后的文件仍需以 MPL-2.0 发布。

## 它们在做什么

`fm1pkg.js` 读取 `.fwsc` 固件包：从每 0x30 字节的第 20 个块里取出一个标记字节，
还原出包身份（如 `FM-1_63002101`）和真正写给设备的逻辑镜像。

`fm1ota.js` 是 FM-1 的 USB-MIDI 升级协议（兼容 M-VAVE 的 M-UPGRADE）：
先握手识别设备（不靠端口名），再让当前固件进入更新模式、喂给它镜像并校验；
设备重启两次后回到新固件，最后用设备自己报的身份确认装的是不是对的包。

协议细节、失败码和恢复方式都写在文件注释里。**不要**在没有备用手段的情况下改这段代码。
