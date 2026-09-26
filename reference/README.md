# 来源与参考范围

本地新增代码和修改按仓库根目录的 GPL-3.0 发布；第三方代码与公开快照的边界见根目录 `THIRD_PARTY.md`。

2026-09-24 已确认：同一台实体设备成功上传并完整显示图片的参考站点是 `https://epdiy.cn/`，而非此前使用的 `https://epd-nrf5.lolicon.in/`。前者当日发布的 HTML、JavaScript、CSS 和图标已保存在 `epdiy/`，文件来源及 SHA-256 见该目录 `manifest.txt`，协议与限制见 `ANALYSIS.md`。该站只公开了打包后的前端文件；未取得未打包工程、源码映射或服务端实现。本地页面依据已发布脚本校正设备 `0x16`、图片槽位和上传时序，不将两个站点视为同一份代码。

本地页面并非该站的逐行复制。针对用户已报告会返回槽位通知的 `0x16` 设备，本地页面额外要求收到有效槽位后才允许上传；一次选槽成功后，会在当前连接内保守地把该槽位视为可能已占用，防止失败重试时跳过覆盖确认。传输参数在写入前验证并在本轮上传中固定，RLE 小 MTU 分包禁止超长；这些是本地安全保护，不应误称为源站原有行为。

2026-09-25 重新读取了 GitHub `tsl0922/EPD-nRF5` 的 `main` 分支，解析到提交 `7e3196193997bd6a4644610c41d54a76eff88760`。协议相关文件快照保存在 `epd-nrf5/`，分析见该目录 `ANALYSIS.md`。该上游提交确认 EPD 服务 UUID、`0x30` 图像写入、`0x05` 刷新、RLE 及“配置通知后再发送 MTU/时间”的顺序，但不包含 `0x16`、`SET_SLOT`、`slots=` 或 `bat=`；这些仍按 `epdiy.cn` 的部署扩展处理。

以下是本地页面最初采用的历史静态文件基线，取自 `https://epd-nrf5.lolicon.in/`，不再作为本设备兼容性的最终依据。下载时保持 HTTPS 证书校验。下列 SHA-256 是下载后、做任何本地改动之前的原始文件校验值；本地 `index.html` 已移除百度统计，UI、上传错误处理及图片异步竞态修复还改动了 `index.html`、`js/main.js` 与 `js/crop.js`。这些数值只用于标识历史基线，不代表当前修改版的哈希。

`index.html`：`https://epd-nrf5.lolicon.in/`，`9226419E1488F87E5E9611EFE354F9BF54E1CDC1E4C8CCEBBB9D8433458C09EB`。

`css/main.css`：`https://epd-nrf5.lolicon.in/css/main.css?v=20251109`，`66FBE714E8535A27305C2029D11704642645A63E76C94EC982FBF7AF76622ACB`。

`js/dithering.js`：`https://epd-nrf5.lolicon.in/js/dithering.js`，`854E2403E08A048A31749A5DCD487DE6D0994D0DAE436D8B5053F44AA20BF9D5`。

`js/rle.js`：`https://epd-nrf5.lolicon.in/js/rle.js`，`D4E5310E98FC28C43DE237521BC5D98CD416966363E09D83539358392840CB34`。

`js/paint.js`：`https://epd-nrf5.lolicon.in/js/paint.js`，`1FD348C78333C61AC48215D99467A1FAEA172700020598E57EA393FAA28C623D`。

`js/crop.js`：`https://epd-nrf5.lolicon.in/js/crop.js`，`5141355AFE231BD70A63FCB015C8A75F6634EF2DEBD2070A5A9CB7FF596AF916`。

`js/main.js`：`https://epd-nrf5.lolicon.in/js/main.js`，`01887752DDEB559367D0B3FC296CB55CB02E03509CB72FDC01219F8DCCC49B0D`。

`legacy/favicon.png`：`https://epd-nrf5.lolicon.in/favicon.png`，`E1D3C18B8B7ED8AE430AF831F3F44F0BA40086EFC654D0C6DECFC1E03C84C2FA`。

历史页面链接到 `https://github.com/tsl0922/EPD-nRF5`，该上游仓库标注 GPL-3.0。当前未确认历史镜像站与上游某一提交完全一致，也未确认 `epdiy.cn` 的版权/许可证归属；不能把新站的打包脚本误标为这个 GitHub 仓库的源码。保留历史来源信息；如需对外发布本地衍生版本，应先核对各静态文件的版权与许可证义务。
