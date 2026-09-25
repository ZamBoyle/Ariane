### Ariane — 日本語。
### 最初の翻訳です。ネイティブスピーカーによる見直しをお願いします。
###
### 形式：Project Fluent（https://projectfluent.org）。基準は en.ftl です。
### メッセージも { $variables } も、en.ftl とまったく同じにしてください。

language-name = 日本語

## この言語のキーボードに印字されているキー名

key-ctrl = Ctrl
key-alt = Alt
key-esc = Esc

## ウィンドウの枠

splash-hide = 起動時にこの画面を表示しない
splash-continue = 続ける
sidebar =
    .aria-label = フォルダーと会話
home-button = Ariane
    .title = スタートページに戻る（Esc）
settings-button =
    .title = 設定：各アシスタントの場所
    .aria-label = 設定を開く
refresh-button =
    .title = 再インデックス（Ctrl+R）
    .aria-label = 会話を再インデックス
folder-filter =
    .placeholder = フォルダーを絞り込む…
    .aria-label = フォルダーと会話を絞り込む
agent-filter =
    .aria-label = 表示するアシスタント
agents-show-all = すべて表示
    .title = すべてのアシスタントを再表示
tree =
    .aria-label = 会話ツリー
tree-loading = 読み込み中…
outline =
    .aria-label = この会話でのあなたのメッセージ

## スタートページ

welcome-title = これまでの会話
welcome-lead = 左のフォルダーを選ぶか、下のバーからすぐに検索できます。
welcome-key-search = 検索
welcome-key-find = 会話内を検索
welcome-key-own = 自分のメッセージ
welcome-key-reindex = 再インデックス
welcome-key-home = ホーム

## フォルダー一覧

tree-no-data = { $dir } に Claude Code のフォルダーが見つかりません。
tree-no-match = 一致するフォルダーはありません。
tree-empty = 会話はありません。
folder-purged-note = （会話ログは削除済み — プロンプトのみ）
folder-approximate-note = （おおよそのパス — フォルダー名から復元）
session-untitled = 無題
session-badge-saved = 保存済み
    .title = 元のファイルはもうありません。Ariane が唯一のコピーを保持しています
session-badge-prompts = プロンプト
    .title = 会話ログは削除済みです。残っているのはあなたのプロンプトだけです
session-summary = { $when } · { $count ->
       *[other] メッセージ { $count } 件
    }

session-models = { $model } +{ $more }
session-tokens = ↑ { $sent } · ↓ { $received }
    .title =
        送信：プロンプト内の新しいトークン { $sentExact }
        受信：{ $receivedExact } トークン
session-tokens-cached = ↑ { $sent } · ↓ { $received } · キャッシュ { $cached }
    .title =
        送信：プロンプト内の新しいトークン { $sentExact }
        受信：{ $receivedExact } トークン
        キャッシュからの再読み込み：{ $cachedExact } トークン（毎ターン再送されるコンテキスト）
session-tokens-subagents = さらにサブエージェント { $count } 件：送信 { $sent }、受信 少なくとも { $received }、キャッシュから再読込 { $cached }

## フッターとインデックス作成

stats = { $folders ->
       *[other] フォルダー { $folders } 個
    } · { $sessions ->
       *[other] 会話 { $sessions } 件
    } · { $messages ->
       *[other] メッセージ { $messages } 件
    }
stats-indexing = インデックス作成中 { $done }…
stats-indexing-agent = { $agent } · インデックス作成中 { $done }…
refresh-done = インデックス作成完了 — { $details }。
refresh-up-to-date = インデックスはすでに最新です。
refresh-read = { $n ->
       *[other] 会話ログ { $n } 件を読み込み
    }
refresh-orphans = { $n ->
       *[other] 履歴から { $n } 件を回収
    }
refresh-saved = { $n ->
       *[other] 会話 { $n } 件を保存
    }
refresh-restored = { $n ->
       *[other] 会話 { $n } 件を復元
    }
refresh-errors = { $n ->
       *[other] エラー { $n } 件
    }
auto-saved = { $n ->
       *[other] 元のファイルが消えた会話 { $n } 件を Ariane が保存しました。
    }

## 開いている会話

convo-empty = この会話には表示できるメッセージがありません。
convo-not-found = 会話が見つかりません。
convo-id =
    .title = この会話の ID — アシスタントが再開に使うもの
convo-message-count = { $n ->
       *[other] メッセージ { $n } 件
    }
convo-part = パート { $n } / { $total }
    .title = この会話の続きは別の会話ログにあります（圧縮・再開・複製）
convo-part-previous =
    .title = 前のパート
    .aria-label = 前のパートへ移動
convo-part-next =
    .title = 次のパート
    .aria-label = 次のパートへ移動
convo-copied = この会話は「{ $title }」から { $count } 件のメッセージをコピーして始まりました。それらは元の会話に表示され、ここでは繰り返しません。
convo-copied-open = 元の会話を開く
convo-subagent = 「{ $title }」から起動されたサブエージェント
convo-subagent-open = 起動元の会話を開く
convo-subagents = この会話から起動されたサブエージェント { $count } 件
subagent-received = ↓ 少なくとも { $received }
usage-floor = サブエージェントの記録には最終的なカウントが残るとは限りません。これらの数値は最小値です。
convo-purged = 会話ログは削除済み
convo-saved = Ariane が保存：元のファイルはもうありません
speaker-you = あなた
order-button =
    .title = メッセージの並び順を反転
order-newest = 新しい順
order-oldest = 古い順
export-button = エクスポート
    .title = この会話をファイルに保存
export-markdown = Markdown (.md)
export-pdf = PDF (.pdf)
copy-command-button = コピー
    .title = 再開コマンドをコピー
open-folder-button = フォルダーを開く
folder-gone = このフォルダーはもうディスク上にありません。
forget-button = 消去
    .title = Ariane が保持しているこの会話のコピーを完全に消去
forget-confirm = 完全に消去しますか？
forget-done = 会話を消去しました。Ariane にはもう何も残っていません。
export-preparing-pdf = PDF を準備中…
export-done = エクスポートしました：{ $path }
message-copy = このメッセージをコピー
message-copied = メッセージをコピーしました

## メッセージの中

part-thinking = 思考
part-tool = ツール
part-result = 結果
part-error = エラー
part-pasted = 貼り付け
part-pasted-lines = { $n ->
       *[other] { $n } 行
    }
part-image = 画像
part-document = ドキュメント
part-empty = （空）
tool-run-calls = { $n ->
       *[other] ツール呼び出し { $n } 件
    }
tool-run-results = { $n ->
       *[other] 結果 { $n } 件
    }
tool-run-attachments = { $n ->
       *[other] 添付 { $n } 件
    }
tool-errors = { $n ->
       *[other] エラー { $n } 件
    }
tool-summary-named = { $summary }：{ $names }
tool-summary-errors = { $summary } — { $errors }

## 通知：人でもアシスタントでもなく、ツールや実行環境からのメッセージ

notice-away-summary = セッションの要約
notice-compact-boundary = 会話を圧縮しました
notice-failure = 失敗
notice-cancelled = リクエストをキャンセルしました
notice-subagent = サブエージェント
notice-generic = 通知

## 開いている会話内の検索

find-input =
    .placeholder = この会話内を検索…
    .aria-label = この会話内を検索
find-count =
    .title = このテキストを含むメッセージのうち、何件目か
find-none = なし
find-previous =
    .title = 前へ（Shift+Enter）
    .aria-label = 前の一致
find-next =
    .title = 次へ（Enter）
    .aria-label = 次の一致
find-close =
    .title = 閉じる（Esc）
    .aria-label = 検索を閉じる

## 会話を専用のターミナルで再開する

resume-button = 再開
resume-button-latest = 再開（最新）
resume-opens = ターミナルを開きます：{ $command }
resume-note-latest-only = Gemini はインデックスか「latest」でしか再開できず、ID では再開できません。
resume-note-unsupported = VS Code では会話を開き直せません。開けるのはフォルダーだけです。
resume-opened = ターミナルを開きました（{ $terminal }）。
resume-opened-settings-ignored = ターミナルを開きました（{ $terminal }）。ただし設定には従っていません：{ $problem }
resume-no-terminal = ターミナルが見つかりません。
resume-folder-missing = この会話のフォルダーはもう存在しません。
resume-command-not-found = このマシンで「{ $command }」が見つかりません。
resume-setting-not-absolute = 設定：「{ $command }」のパスは絶対パスにしてください（{ $path }）。
resume-setting-unusable = 設定：{ $path } はプログラムではありません。
resume-interpreter-not-found = 「{ $command }」には「{ $interpreter }」が必要ですが、見つかりません。
resume-failed = ターミナルを開けませんでした（{ $reason }）。
resume-failed-copied = { $reason } コマンドをコピーしました。
command-copied = コマンドをコピーしました。
open-settings-action = 設定を開く

## 検索バー

results =
    .aria-label = 検索結果
search-input =
    .placeholder = 会話を検索…
    .aria-label = 会話を検索
scope-select =
    .aria-label = 検索範囲
    .title = 検索する場所
scope-all = すべて
scope-folder = フォルダー：{ $name }
scope-folder-current = フォルダー：現在
scope-session = この会話
period-select =
    .aria-label = 検索期間
    .title = 期間
period-all = すべての期間
period-7d = 過去 7 日間
period-30d = 過去 30 日間
period-year = 今年
results-count = { $n ->
       *[other] { $n } 件の結果
    }
results-none = 結果はありません。
results-none-7d = 過去 7 日間の結果はありません。
results-none-30d = 過去 30 日間の結果はありません。
results-none-year = 今年の結果はありません。

## 設定ウィンドウ

settings-title = 設定
settings-lead = 「再開」で使う、各アシスタントのコマンドの場所です。パスを空欄にすると Ariane が自分で探します。
settings-language = 言語
settings-language-auto = 自動 — { $language }
settings-language-select =
    .aria-label = アプリの言語
settings-theme = テーマ
settings-theme-select =
    .aria-label = アプリの配色テーマ
settings-theme-auto = システム
settings-theme-light = ライト
settings-theme-dark = ダーク
settings-updates = 更新
settings-updates-select =
    .aria-label = 新しいバージョンがあるかを Ariane が問い合わせてよいか
settings-updates-never = 確認しない
settings-updates-startup = 起動時に確認
settings-text-size = 文字サイズ
settings-text-size-select =
    .aria-label = アプリ全体の文字サイズ
settings-update-now = 今すぐ確認
update-now-checking = 確認中…
update-now-current = Ariane { $version } は最新です。
update-now-failed = GitHub から応答がありません。後でもう一度お試しください。
update-available = Ariane { $version } が利用できます。
update-open = リリースを見る
update-close =
    .aria-label = 閉じる
settings-add = アシスタントを追加
settings-add-menu =
    .aria-label = 追加するアシスタント
settings-open-json = JSON ファイルを開く
settings-cancel = キャンセル
settings-save = 保存
settings-sessions = { $n ->
        [0] 会話なし
       *[other] 会話 { $n } 件
    }
settings-detected = 検出：{ $path }
settings-not-detected = 自動検索では見つかりません。
settings-path-label = 使用するパス
settings-path-input =
    .placeholder = 空欄：Ariane が自分で探します
    .aria-label = { $agent } に使用するパス
settings-browse = 参照…
    .aria-label = { $agent } を参照
settings-check-pending = 確認中…
settings-check-chosen = 指定どおり使用：{ $path }
settings-check-detected = Ariane が使用：{ $path }
settings-check-not-found = このマシンでは見つかりません。パスを入力してください。
settings-check-not-absolute = 絶対パスを指定してください。
settings-check-unusable = { $path } はプログラムではありません。
settings-check-interpreter = 見つかりましたが、必要な「{ $interpreter }」が見つかりません。
settings-check-refused = パスが拒否されました：{ $detail }。
settings-unreadable = 設定ファイルを読み込めません（{ $error }）。Ariane は上書きしません。ファイルを開いて修正してください。
settings-saved = 設定を保存しました。
settings-opened = 設定をエディターで開きました。
settings-opened-at = 設定：{ $path }
settings-opened-unreadable = 設定を開きましたが、読み込めません：{ $error }

## お気に入りとメモ：会話に自分でつける目印

mark-favorite = お気に入りに追加
mark-favorite-on = お気に入り — クリックで解除
mark-message = このメッセージをお気に入りに追加
mark-message-on = お気に入り — クリックで解除
mark-note = メモ
    .title = この会話にメモを書く
mark-note-input =
    .placeholder = この会話が大切な理由…
    .aria-label = この会話へのメモ
mark-note-saved = メモを保存しました
favorites-view = お気に入り
    .title = お気に入りにしたすべての会話
favorites-conversations = 会話
favorites-messages = メッセージ
favorites-quote = 「{ $text }」
favorites-empty = お気に入りはまだありません。会話の上部にある星を押すと、ここに集まります。
error-marks-unreadable = お気に入りとメモのファイルを読み込めないため、何も書き込んでいません：{ $error }

## 設定ファイル本体：settings.json の先頭に、ファイルを開く人のために書かれる

settings-file-intro = 「再開」のために Ariane が各アシスタントのコマンドを見つける場所。
settings-file-detected = 「detected」：Ariane が自分で見つけたもの。このファイルを開くたびに更新されます。
settings-file-command = 「command」：空にすると Ariane が探します。絶対パスを入れると、そのパスが使われます。
settings-file-example = 例（codex の場合）：{ $example }
settings-file-paths = ~ はホームフォルダーを表します。
settings-file-paths-windows = パスの区切りには普通のスラッシュ / を使ってください。%APPDATA% と ~ も使えます。
settings-file-language = 「language」：システムに合わせるなら「auto」、または「ja」や「en」などの言語コード。
settings-file-theme = 「theme」: システムに従うなら「auto」、そうでなければ「light」か「dark」。

## アプリが報告するエラー

error-forget-not-saved = 消去できるのは Ariane が保存した会話だけです。ほかの会話は、それぞれのアシスタントのファイルにあります。
error-message-not-found = メッセージが見つかりません。
error-resume-impossible = この会話は再開できません（{ $reason }）。
error-settings-unreadable = 設定を読み込めないため、何も書き込んでいません：{ $error }
browse-title = { $agent } はどこにありますか？

## エクスポート：Markdown ファイルに書き出した会話、または PDF に印刷した会話

export-dialog-title = 会話をエクスポート
export-file-name = 会話
export-field = { $label }：{ $value }
export-field-assistant = アシスタント
export-field-folder = フォルダー
export-field-branch = ブランチ
export-field-period = 期間
export-field-messages = メッセージ
export-period = { $from } から { $to } まで
export-order-newest = 新しい順
export-order-oldest = 古い順
export-messages = { $count } 件、{ $order }
export-saved = Ariane が保存：元のファイルはもうありません。
export-footer = Ariane からエクスポートしました。
export-footer-at = { $date } に Ariane からエクスポートしました。

## Statistics

stats-button =
    .title = 統計
    .aria-label = 統計を表示
stats-footer-title = 統計を表示
stats-title = 統計
stats-loading = 集計中…
stats-period = { $period } · 会話 { $sessions } 件 · フォルダー { $folders } 件
stats-hidden = サイドバーで非表示の { $count } 個のアシスタントは集計に含まれません。
stats-empty = この期間には何も書かれていません。
stats-who = 誰が書いたか
stats-you = あなたの入力
stats-replies = アシスタントの返答
stats-tools = ツールの出力
stats-notices = システム通知
stats-share = 表示分の { $share }
stats-records = サイドバーの件数は { $records } 件です。そのうち { $empty } 件には表示する内容がありません。
stats-masked = そのうち { $masked } 件は、Claude が暗号化した形でしか残さない推論です。署名しか残っていません。
stats-tokens = トークン
stats-sent = ↑ 送信
    .title = プロンプトの新しい部分：新規の入力と、キャッシュに書き込まれたもの
stats-received = ↓ 受信
    .title = アシスタントが書いたもの（推論を含む）
stats-cache = キャッシュからの再読み込み
    .title = 毎ターン再送されるコンテキスト。ほかとは分けて扱い、合計しません
stats-exact = { $value } トークン
stats-coverage = 会話 { $total } 件のうち { $measured } 件で計測。
stats-uncovered = { $agents } は Ariane が読めるトークン数を記録しません。
stats-subagents = さらにサブエージェント { $count } 件が { $sent } トークンを送信し、少なくとも { $received } トークンを受信し、{ $cached } トークンをキャッシュから再読込しました。上の数値には含まれていません。サブエージェントの記録には最終的なカウントが残るとは限らないためです。
stats-months = 月ごと
stats-measure-you = あなたのメッセージ
stats-measure-replies = 返答
stats-measure-received = 受信トークン
stats-months-table = 表で表示
stats-col-month = 月
stats-undated = 日付のないメッセージ { $count } 件はグラフに含まれません。
stats-chart = { $measure }（月ごと）
stats-bar = { $month }：{ $value }
stats-by-agent = アシスタント別
stats-by-model = モデル別
stats-by-folder = 活動の多いフォルダー
stats-col-assistant = アシスタント
stats-col-conversations = 会話
stats-col-you = あなた
stats-col-replies = 返答
stats-col-received = ↓ 受信
stats-col-model = モデル
stats-col-folder = フォルダー
stats-col-messages = メッセージ
stats-others = ほか { $count } モデル
stats-not-measured = 記録なし
stats-folder-note = あなたのメッセージと返答。ツールの出力は数えません。
stats-quotas = 利用上限
stats-quota-window = { $minutes ->
        [300] 5時間枠
        [10080] 週
       *[other] { $hours }時間枠
    }
stats-quota-refused = 上限に到達
stats-quota-resets = { $date }にリセット
stats-quota-reset-since = { $date }にリセット済み
stats-quota-read = { $date }に読み取り
stats-quota-plan = プラン「{ $plan }」
stats-quota-limit = 上限「{ $limit }」
stats-quota-credits = 残りクレジット { $balance }
stats-quota-no-credits = クレジットなし
stats-quota-unlimited = クレジット無制限
stats-quota-reached = { $minutes ->
        [300] 5時間の上限
        [10080] 週の上限
       *[other] { $hours }時間の上限
    }に{ $count }回到達、最後は{ $date }。
stats-quota-history = { $minutes ->
        [300] 読み取った5時間枠ごとの最高値
        [10080] 読み取った週ごとの最高値
       *[other] 読み取った{ $hours }時間枠ごとの最高値
    }
stats-quota-ending = { $date }に終わる枠
stats-quota-col-end = 枠の終わり
stats-quota-col-used = 最高値
stats-quota-note = 割合は読み取り値であり、合計ではありません。各枠には最高値とその読み取り日時を表示します。Ariane はどのサーバーにも問い合わせず、アシスタントが書いたものを読むだけです。Codex は返答のたびに、Claude は保存した最後の読み取り値、インストールされていれば Claude Desktop の履歴、そして上限で拒否されたリクエストのたびに記録します。
