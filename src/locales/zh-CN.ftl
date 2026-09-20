### Ariane — 简体中文。
### 初次翻译，建议请母语人士审校。
###
### 格式：Project Fluent（https://projectfluent.org）。以 en.ftl 为准：
### 相同的消息，相同的 { $variables }。

language-name = 简体中文

## 本语言键盘上印着的按键名

key-ctrl = Ctrl
key-alt = Alt
key-esc = Esc

## 窗口框架

splash-hide = 启动时不再显示此画面
splash-continue = 继续
sidebar =
    .aria-label = 文件夹和对话
home-button = Ariane
    .title = 返回首页（Esc）
settings-button =
    .title = 设置：各个助手的位置
    .aria-label = 打开设置
refresh-button =
    .title = 重建索引（Ctrl+R）
    .aria-label = 为对话重建索引
folder-filter =
    .placeholder = 筛选文件夹…
    .aria-label = 筛选文件夹和对话
agent-filter =
    .aria-label = 显示的助手
agents-show-all = 全部显示
    .title = 重新显示所有助手
tree =
    .aria-label = 对话树
tree-loading = 正在加载…
outline =
    .aria-label = 你在此对话中的消息

## 首页

welcome-title = 你以往的对话
welcome-lead = 在左侧选择一个文件夹，或直接在下方的搜索栏里搜索。
welcome-key-search = 搜索
welcome-key-find = 在对话中查找
welcome-key-own = 你的消息
welcome-key-reindex = 重建索引
welcome-key-home = 首页

## 文件夹列表

tree-no-data = 在 { $dir } 中未找到 Claude Code 的文件夹。
tree-no-match = 没有匹配的文件夹。
tree-empty = 没有对话。
folder-purged-note = （对话记录已清除——只剩提示词）
folder-approximate-note = （路径为近似值——根据文件夹名推算）
session-untitled = 无标题
session-badge-saved = 已保存
    .title = 原始文件已不存在：Ariane 保留着唯一的副本
session-badge-prompts = 提示词
    .title = 对话记录已清除：只剩下你的提示词
session-summary = { $when } · { $count ->
       *[other] { $count } 条消息
    }

## 页脚与索引

stats = { $folders ->
       *[other] { $folders } 个文件夹
    } · { $sessions ->
       *[other] { $sessions } 个对话
    } · { $messages ->
       *[other] { $messages } 条消息
    }
stats-indexing = 正在索引 { $done }…
stats-indexing-agent = { $agent } · 正在索引 { $done }…
refresh-done = 索引完成——{ $details }。
refresh-up-to-date = 索引已是最新。
refresh-read = { $n ->
       *[other] 读取 { $n } 份对话记录
    }
refresh-orphans = { $n ->
       *[other] 从历史记录中找回 { $n } 个
    }
refresh-saved = { $n ->
       *[other] 保存 { $n } 个对话
    }
refresh-restored = { $n ->
       *[other] 恢复 { $n } 个对话
    }
refresh-errors = { $n ->
       *[other] { $n } 个错误
    }
auto-saved = { $n ->
       *[other] 有 { $n } 个对话的原始文件已消失，Ariane 已将它们保存下来。
    }

## 打开的对话

convo-empty = 此对话中没有可显示的消息。
convo-not-found = 未找到对话。
convo-message-count = { $n ->
       *[other] { $n } 条消息
    }
convo-part = 第 { $n } 部分，共 { $total } 部分
    .title = 此对话已压缩：后续内容在另一份对话记录中
convo-part-previous =
    .title = 上一部分
    .aria-label = 跳到上一部分
convo-part-next =
    .title = 下一部分
    .aria-label = 跳到下一部分
convo-purged = 对话记录已清除
convo-saved = 由 Ariane 保存：原始文件已不存在
speaker-you = 你
order-button =
    .title = 反转消息的顺序
order-newest = 最新的在上
order-oldest = 最早的在上
export-button = 导出
    .title = 将此对话保存为文件
export-markdown = Markdown (.md)
export-pdf = PDF (.pdf)
copy-command-button = 复制
    .title = 复制继续对话的命令
open-folder-button = 打开文件夹
folder-gone = 此文件夹已不在磁盘上。
forget-button = 删除
    .title = 永久删除 Ariane 保存的这份对话副本
forget-confirm = 确定永久删除？
forget-done = 对话已删除：Ariane 不再保留它的任何内容。
export-preparing-pdf = 正在准备 PDF…
export-done = 已导出：{ $path }
message-copy = 复制此消息
message-copied = 消息已复制

## 消息内部

part-thinking = 推理
part-tool = 工具
part-result = 结果
part-error = 错误
part-pasted = 粘贴内容
part-pasted-lines = { $n ->
       *[other] { $n } 行
    }
part-image = 图片
part-document = 文档
part-empty = （空）
tool-run-calls = { $n ->
       *[other] { $n } 次工具调用
    }
tool-run-results = { $n ->
       *[other] { $n } 个结果
    }
tool-run-attachments = { $n ->
       *[other] { $n } 个附件
    }
tool-errors = { $n ->
       *[other] { $n } 个错误
    }
tool-summary-named = { $summary }：{ $names }
tool-summary-errors = { $summary }——{ $errors }

## 通知：说话的是工具或运行环境，既不是用户也不是助手

notice-away-summary = 会话摘要
notice-compact-boundary = 对话已压缩
notice-failure = 失败
notice-cancelled = 请求已取消
notice-subagent = 子代理
notice-generic = 通知

## 在打开的对话中查找

find-input =
    .placeholder = 在此对话中查找…
    .aria-label = 在此对话中查找
find-count =
    .title = 在所有包含该文本的消息中，当前是第几条
find-none = 无
find-previous =
    .title = 上一个（Shift+Enter）
    .aria-label = 上一个匹配项
find-next =
    .title = 下一个（Enter）
    .aria-label = 下一个匹配项
find-close =
    .title = 关闭（Esc）
    .aria-label = 关闭查找

## 在对话自己的终端里继续

resume-button = 继续
resume-button-latest = 继续（最新）
resume-opens = 打开终端：{ $command }
resume-note-latest-only = Gemini 只能按索引或“latest”继续，不能按 id 继续。
resume-note-unsupported = VS Code 不支持重新打开对话，只能打开它的文件夹。
resume-opened = 已打开终端（{ $terminal }）。
resume-opened-settings-ignored = 已打开终端（{ $terminal }），但未遵循设置：{ $problem }
resume-no-terminal = 未找到终端。
resume-folder-missing = 此对话的文件夹已不存在。
resume-command-not-found = Ariane 在本机上找不到“{ $command }”。
resume-setting-not-absolute = 设置：“{ $command }”的路径必须是绝对路径（{ $path }）。
resume-setting-unusable = 设置：{ $path } 不是程序。
resume-interpreter-not-found = “{ $command }”需要“{ $interpreter }”，但找不到它。
resume-failed = 无法打开终端（{ $reason }）。
resume-failed-copied = { $reason } 命令已复制。
command-copied = 命令已复制。
open-settings-action = 打开设置

## 搜索栏

results =
    .aria-label = 搜索结果
search-input =
    .placeholder = 搜索你的对话…
    .aria-label = 搜索对话
scope-select =
    .aria-label = 搜索范围
    .title = 在哪里搜索
scope-all = 全部
scope-folder = 文件夹：{ $name }
scope-folder-current = 文件夹：当前
scope-session = 此对话
period-select =
    .aria-label = 搜索时间范围
    .title = 时间
period-all = 不限日期
period-7d = 最近 7 天
period-30d = 最近 30 天
period-year = 今年
results-count = { $n ->
       *[other] { $n } 条结果
    }
results-none = 没有结果。
results-none-7d = 最近 7 天内没有结果。
results-none-30d = 最近 30 天内没有结果。
results-none-year = 今年没有结果。

## 设置窗口

settings-title = 设置
settings-lead = 为“继续”指定各助手命令的位置。路径留空时，Ariane 会自己查找。
settings-language = 语言
settings-language-auto = 自动 — { $language }
settings-language-select =
    .aria-label = 应用的语言
settings-theme = 主题
settings-theme-select =
    .aria-label = 应用的配色主题
settings-theme-auto = 跟随系统
settings-theme-light = 浅色
settings-theme-dark = 深色
settings-add = 添加助手
settings-add-menu =
    .aria-label = 可添加的助手
settings-open-json = 打开 JSON 文件
settings-cancel = 取消
settings-save = 保存
settings-sessions = { $n ->
        [0] 没有对话
       *[other] { $n } 个对话
    }
settings-detected = 已找到：{ $path }
settings-not-detected = 自动搜索未能找到。
settings-path-label = 使用的路径
settings-path-input =
    .placeholder = 留空：由 Ariane 自己查找
    .aria-label = { $agent } 使用的路径
settings-browse = 浏览…
    .aria-label = 浏览查找 { $agent }
settings-check-pending = 正在检查…
settings-check-chosen = 按填写的内容使用：{ $path }
settings-check-detected = Ariane 将使用：{ $path }
settings-check-not-found = 本机上找不到：请填写它的路径。
settings-check-not-absolute = 路径必须是绝对路径。
settings-check-unusable = { $path } 不是程序。
settings-check-interpreter = 已找到，但它需要“{ $interpreter }”，而后者找不到。
settings-check-refused = 路径被拒绝：{ $detail }。
settings-unreadable = 无法读取设置文件（{ $error }）。Ariane 不会覆盖它：请打开并修正。
settings-saved = 设置已保存。
settings-opened = 已在你的编辑器中打开设置。
settings-opened-at = 设置：{ $path }
settings-opened-unreadable = 已打开设置，但无法读取：{ $error }

## 收藏与笔记：你自己为对话留下的标记

mark-favorite = 收藏此对话
mark-favorite-on = 已收藏——点击取消
mark-message = 收藏此消息
mark-message-on = 已收藏——点击取消
mark-note = 笔记
    .title = 为此对话写一条笔记
mark-note-input =
    .placeholder = 这次对话为什么重要…
    .aria-label = 关于此对话的笔记
mark-note-saved = 笔记已保存
favorites-view = 收藏
    .title = 你收藏过的所有对话
favorites-conversations = 对话
favorites-messages = 消息
favorites-quote = “{ $text }”
favorites-empty = 还没有收藏。点击对话顶部的星标，它就会收在这里。
error-marks-unreadable = 无法读取收藏和笔记的文件，因此未写入任何内容：{ $error }

## 设置文件本身：写在 settings.json 顶部，供打开它的人阅读

settings-file-intro = Ariane 为“继续”查找各助手命令的位置。
settings-file-detected = “detected”：Ariane 自己找到的内容。每次打开此文件时更新。
settings-file-command = “command”：留空则由 Ariane 查找；填入绝对路径则固定使用该路径。
settings-file-example = 示例（codex）：{ $example }
settings-file-paths = ~ 表示你的主文件夹。
settings-file-paths-windows = 路径请使用正斜杠 /。%APPDATA% 和 ~ 都可以使用。
settings-file-language = “language”：填“auto”跟随系统，或填语言代码，例如“zh-CN”或“en”。
settings-file-theme = “theme”：“auto” 跟随系统，或填 “light”、“dark”。

## 应用报告的错误

error-forget-not-saved = 只有 Ariane 保存的对话才能删除：其他对话保存在各自助手的文件里。
error-message-not-found = 未找到消息。
error-resume-impossible = 无法继续此对话（{ $reason }）。
error-settings-unreadable = 无法读取设置，因此未写入任何内容：{ $error }
browse-title = { $agent } 在哪里？

## 导出：写入 Markdown 文件或打印为 PDF 的对话

export-dialog-title = 导出对话
export-file-name = 对话
export-field = { $label }：{ $value }
export-field-assistant = 助手
export-field-folder = 文件夹
export-field-branch = 分支
export-field-period = 时间段
export-field-messages = 消息
export-period = { $from } 至 { $to }
export-order-newest = 从新到旧
export-order-oldest = 从旧到新
export-messages = { $count } 条，{ $order }
export-saved = 由 Ariane 保存：原始文件已不存在。
export-footer = 由 Ariane 导出。
export-footer-at = 由 Ariane 于 { $date } 导出。
