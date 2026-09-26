# Official EPD-nRF5 source review

This snapshot was read from the public GitHub API on 2026-09-25. The `main`
branch resolved to commit `7e3196193997bd6a4644610c41d54a76eff88760`.
Only protocol-relevant files are stored here; this is not a complete SDK
checkout. SHA-256 values for the stored files are listed in `manifest.txt`.

The upstream firmware defines the vendor EPD service UUID
`62750001-d828-918d-fb46-b6c11c675aec`, the image characteristic
`62750002-d828-918d-fb46-b6c11c675aec`, and the app-version characteristic
`62750003-d828-918d-fb46-b6c11c675aec`. After notifications are enabled, the
firmware sends the binary `epd_config_t`; `INIT` then produces textual `mtu=`
and `t=` notifications. The image protocol uses `WRITE_IMAGE` (`0x30`) and
`REFRESH` (`0x05`), with the RLE flag and payload format implemented in
`EPD_service.c`.

The current upstream tree does not contain `SET_SLOT` (`0x31`), `slots=`,
`bat=`, or the `0x16` SSD1683 mapping used by the `epdiy.cn` deployment. Those
are deployment-specific extensions evidenced by the separate site snapshot;
they must not be described as upstream GitHub behavior.
