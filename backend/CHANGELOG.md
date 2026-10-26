# Changelog

## [0.1.1](https://github.com/cheminfo/service-monitor/compare/service-monitor-backend-v0.1.0...service-monitor-backend-v0.1.1) (2026-10-26)


### Bug Fixes

* retry a failed read of the logs while live, and keep every filter clearable ([c669ff9](https://github.com/cheminfo/service-monitor/commit/c669ff9c4546a45711f28a96708cfa0aaf693f03))

## 0.1.0 (2026-10-22)


### Features

* judge a service's health at /status, open the store once, and show it all on one page ([0580e34](https://github.com/cheminfo/service-monitor/commit/0580e34ddc488d766866f5b7e10db7ce95bdf75c))
* keep and read the logs and status of every process of a service ([7881f4b](https://github.com/cheminfo/service-monitor/commit/7881f4bef8757ad82cf3e33c087f43669aea0f4b))
* keep the monitor store at one path, sqlite/monitor.sqlite of DATA_DIR ([4d6cbd3](https://github.com/cheminfo/service-monitor/commit/4d6cbd32f700e2a7d11c8e1a59879a54be36edee))
