# iptv-cctv-weishi
从订阅源中只获取央视和卫视、少儿、音乐、动漫频道
              
变量名  SOURCES，                  多个直播订阅源 URL，用 , 分隔

变量名  EPG_URL，                  EPG 的 xmltv 地址，用 , 分隔

变量名  AUTH_KEY，                 访问订阅链接的密钥，比如 mypassword

KV变量名  IPTV_KV，                EdgeOne KV Namespace，用于存储缓存（需在控制台创建并绑定）

部署在edgeone的makers上：部署步骤（GitHub → EdgeOne Makers）
第一步：GitHub

把以上文件 push 到你的 GitHub 仓库或者fork。

第二步：EdgeOne Makers 控制台
创建 Makers 项目 → 导入 GitHub 仓库。
设置环境变量：
AUTH_KEY = 你自己的密码
SOURCES = url1,url2
EPG_URL = epg1,epg2（可选）
创建 KV Namespace：
进入「KV 存储」→ 创建命名空间，名字随便（比如 iptv-cache）。
进入「项目设置 → 函数绑定」→ 添加 KV 绑定，变量名填 IPTV_KV，选择刚创建的 namespace。
部署。
第三步：使用
伪装主页：https://你的域名 → 看到 HTML 页面。
订阅链接：https://你的域名/iptv.m3u?key=你自己的密码 → 返回 M3U。
在 TiviMate / VLC 等播放器中添加这个订阅链接即可。
