# iptv-cctv-weishi
从订阅源中只获取央视和卫视、少儿、音乐、动漫频道
              
变量名  SOURCES，                  多个直播订阅源 URL，用 , 分隔

变量名  EPG_URL，                  EPG 的 xmltv 地址，用 , 分隔

变量名  AUTH_KEY，                 访问订阅链接的密钥，比如 mypassword

KV变量名  IPTV_KV，                EdgeOne KV Namespace，用于存储缓存（需在控制台创建并绑定）

部署在edgeone的makers上
