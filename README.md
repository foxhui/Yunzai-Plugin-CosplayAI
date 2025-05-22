# Yunzai-Plugin-CosplayAI
使用Google Gemini接口让云崽机器人进行角色扮演（支持图片理解）

# 使用
- 自行修改文件开头的配置区
- APIKey 需要自行去[Google AI Studio](https://aistudio.google.com/apikey)生成（免费额度完全够用）
- 系统Prompt可以修改为你自己喜欢的角色的
> [!WARNING]
> GeminiAPI无法在中国大陆内使用，请自行优化网络环境

# 网络环境优化
- 使用海外服务器搭建机器人或者使用Caddy和Nginx反向代理
- 使用Vercel/Netlify/Deno/ClawCloudRun/CFWorkers/Railway/LeanCloud/等免费ServerLess平台进行反向代理
