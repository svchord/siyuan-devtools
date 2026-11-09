# Changelog

## [0.2.0](https://github.com/svchord/siyuan-devtools/compare/v0.1.0...v0.2.0) (2026-11-09)


### ⚠ BREAKING CHANGES

* 恢复移动端 390x844 与自定义视口的语义

### Bug Fixes

* shot 沿用会话里 --device 指定的机型 ([6d203b1](https://github.com/svchord/siyuan-devtools/commit/6d203b107ce0dc3faddb87c98e51a32732bd8d75))
* 会话状态持久化，设备模拟在 reload/audit/shot 上也生效 ([8088adb](https://github.com/svchord/siyuan-devtools/commit/8088adb6831129355be43992ecc11a5f4feb551e))
* 修好 --flag=value、-- 字面量分隔与全局选项剥离 ([2a70520](https://github.com/svchord/siyuan-devtools/commit/2a70520319176392f0518d42201f5efb661fb373))
* 修掉一批会静默产出错误结果的历史遗留 ([b2ae2f8](https://github.com/svchord/siyuan-devtools/commit/b2ae2f819e438d589e028c52bc190bdbd982b0af))
* 修正 playwright-core cli 定位，避免发布后不可用 ([cc00e40](https://github.com/svchord/siyuan-devtools/commit/cc00e4032a72f3d02a29ce20dc727f0715dc2167))
* 修正明暗/密度/就绪判断，并加入测量格矩阵 ([00f90be](https://github.com/svchord/siyuan-devtools/commit/00f90be8a97909f891b9f39e9f91cb2805598a29))
* 对比度不再把现代颜色函数算成错值，读数不再静默返回空 ([707cfb2](https://github.com/svchord/siyuan-devtools/commit/707cfb2c04c461ed4ce917ddfaff046a34d54b3b))
* 恢复移动端 390x844 与自定义视口的语义 ([d5ed8e5](https://github.com/svchord/siyuan-devtools/commit/d5ed8e587261c9e37d2ab836ca91c720bbbc0ed4))
* 移动端补设备模拟，令牌拼错不再静默通过 ([89b6717](https://github.com/svchord/siyuan-devtools/commit/89b67177a7d8c01dd778d58ed1f0d193490b333d))
* 计划校验拦住「字段放错步骤」，contrast 步骤补上 ratio ([ff5c3de](https://github.com/svchord/siyuan-devtools/commit/ff5c3de6c116762a03818e3fed91e72587c52ba4))


### Performance Improvements

* shot 与 reload 改用 CDP 就地切设备，不再重开浏览器 ([d9cd83a](https://github.com/svchord/siyuan-devtools/commit/d9cd83a2af48c0c855aa606d40642bebb541286d))
