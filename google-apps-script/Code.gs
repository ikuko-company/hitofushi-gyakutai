/**
 * 委員会準備 Web アプリ — シンプル・安定版
 */

var GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/** 出欠回答の追記先スプレッドシート（スクリプトと同一の Google アカウントでアクセス可能であること） */
const ATTENDANCE_SHEET_ID = "17S6cuRmOPDA949VNnFrcq1qrndRyBAOIWtQYoX8XOfQ";

/** 管理パネルから保存する議案書データ（Properties の値は 1 キーあたり約 9KB まで） */
var AGENDA_DATA_PROPERTY_KEY = "COMMITTEE_AGENDA_JSON_V1";

// ---------------------------------------------------------------------------
// Web: 出欠フォーム（GET）— プロジェクト内に HTML ファイル「attendance_form」を配置すること
// ---------------------------------------------------------------------------
function doGet(e) {
  var p = e && e.parameter ? e.parameter : {};
  if (p.action === "getAgenda") {
    var agenda = getLatestAgendaData();
    return outJson_({ ok: true, agenda: agenda });
  }
  return HtmlService.createHtmlOutputFromFile("attendance_form")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setTitle("虐待防止委員会 出欠のご回答");
}

/**
 * 議案データを Script Properties に保存する（JSON 文字列）
 * @param {Object} data
 */
function saveAgendaData(data) {
  var payload = data == null ? {} : data;
  var s = JSON.stringify(payload);
  if (s.length > 9200) {
    throw new Error(
      "議案データが大きすぎます（上限約9KB）。改定案のテキストを短くするか、共有メモを削ってから再度お試しください。"
    );
  }
  PropertiesService.getScriptProperties().setProperty(AGENDA_DATA_PROPERTY_KEY, s);
}

/**
 * 保存済みの議案データを返す。未保存時は null
 * @return {Object|null}
 */
function getLatestAgendaData() {
  var raw = PropertiesService.getScriptProperties().getProperty(AGENDA_DATA_PROPERTY_KEY);
  if (!raw || !String(raw).trim()) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// LINE送信処理
// ---------------------------------------------------------------------------
function sendLineMessage(message) {
  const CHANNEL_ACCESS_TOKEN = "xzH6qeMiBvo6TfarYw8Zf5z2idc0HhCo2OWA0EMZsD+qWrrCswvPMmBrwct5y+ZNgm4jcRtpuuS1TNsB0/uX1Li0NpQzMll3rzsRVqAxY9MmGd9I1PSui/hD0MWcMzwbS5v8vxaxdHDS3pxrXxMKUwdB04t89/1O/w1cDnyilFU=";
  const USER_ID = "Cb1def1c35aaf2e255a4a67ccded2ba44";
  const url = "https://api.line.me/v2/bot/message/push";
  const payload = {
    to: USER_ID,
    messages: [{ type: "text", text: message }],
  };
  UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + CHANNEL_ACCESS_TOKEN },
    payload: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// エントリ（POSTリクエストの受け口）
// ---------------------------------------------------------------------------
function doPost(e) {
  var data;
  try {
    data = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
  } catch (err) {
    return ContentService.createTextOutput("Success");
  }

  if (data && data.action === "submitAttendance") {
    return handleAttendanceSubmit(data);
  }

  if (data && data.action === "generateThemes") {
    return handleAiRequest(data);
  }

  if (data && data.action === "generateRevision") {
    return handleRevisionRequest(data);
  }

  if (data && data.action === "saveAgenda") {
    return handleSaveAgendaRequest(data);
  }

  return handleLineRequest(data);
}

/**
 * 管理パネルからの議案確定（議案書 HTML が GET で読み取るデータ）
 */
function handleSaveAgendaRequest(data) {
  try {
    var agenda = data && data.agenda && typeof data.agenda === "object" ? data.agenda : {};
    agenda.savedAt = new Date().toISOString();
    saveAgendaData(agenda);
    return outJson_({ ok: true });
  } catch (ex) {
    return outJson_({
      ok: false,
      error: String(ex && ex.message ? ex.message : ex),
    });
  }
}

// ---------------------------------------------------------------------------
// 出欠: スプレッドシートへ追記
// ---------------------------------------------------------------------------
function handleAttendanceSubmit(data) {
  try {
    var sheet = SpreadsheetApp.openById(ATTENDANCE_SHEET_ID).getActiveSheet();
    sheet.appendRow([new Date(), data.date, data.name, data.attendance, data.note]);
    return outJson_({ ok: true });
  } catch (ex) {
    return outJson_({ ok: false, error: String(ex && ex.message ? ex.message : ex) });
  }
}

// ---------------------------------------------------------------------------
// AI: テーマ作成処理
// ---------------------------------------------------------------------------
function handleAiRequest(data) {
  var name = (data && data.facilityName) || "";
  var stype = (data && data.serviceType) || "";
  var situation = (data && data.situation) || "";
  var systemHint = (data && data.systemPrompt) || "";

  var key = (data && data.apiKey && String(data.apiKey).trim()) || PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) {
    return outJson_({ ok: false, error: "Gemini API キーがありません。" });
  }

  var prompt = buildThemePrompt_(name, stype, situation, systemHint);

  try {
    var text = callGeminiFlash_(key, prompt);
    var themes = extractThemes_(text);
    return outJson_({ ok: true, raw: text, themes: themes });
  } catch (ex) {
    return outJson_({ ok: false, error: String(ex && ex.message ? ex.message : ex) });
  }
}

// ---------------------------------------------------------------------------
// AIへの指示書（プロンプト）
// ---------------------------------------------------------------------------
function buildThemePrompt_(facilityName, serviceType, situation, systemPrompt) {
  var hint = systemPrompt && String(systemPrompt).trim() ? "【追加の方針】\n" + String(systemPrompt).trim() + "\n\n" : "";
  return (
    hint +
    "あなたは障害福祉領域の「虐待防止委員会」の専門アシスタントです。\n" +
    "【自事業所の現状】を分析し、委員会の議題テーマ案を「必ず3件」提案してください。\n\n" +
    "【テーマ作成の条件】\n" +
    "1. 以下の3つの視点で1件ずつ（計3件）作成すること。\n" +
    "   ・1件目：事象への直接的な対応・再発防止策\n" +
    "   ・2件目：マニュアルや組織体制など、仕組みの見直し\n" +
    "   ・3件目：職員の倫理観育成や研修など、教育的アプローチ\n" +
    "2. 各テーマは「〜〜に向けた検討」で終わる、実践的な見出し（40字程度）にすること。\n" +
    "3. 文章中に「カギカッコ」や「改行」を使用しないこと。\n\n" +
    "【自事業所の現状】\n" +
    (String(situation).trim() || "（記載なし）") +
    "\n\n" +
    "必ず以下の形式の JSON オブジェクトを出力してください。\n" +
    '{"themes":["1件目のテーマ","2件目のテーマ","3件目のテーマ"]}'
  );
}

// ---------------------------------------------------------------------------
// Gemini API 呼び出し（JSON強制モード）
// ---------------------------------------------------------------------------
function callGeminiFlash_(apiKey, userPrompt) {
  var url = GEMINI_URL + "?key=" + encodeURIComponent(apiKey);
  var payload = {
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.55,
      responseMimeType: "application/json" // JSONで返すことを強制
    },
  };
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) throw new Error("Gemini Error: " + body);

  var json = JSON.parse(body);
  var text = json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text;
  if (!text) throw new Error("本文が取得できません。");
  return String(text);
}

// ---------------------------------------------------------------------------
// データ抽出（AIからの返答を安全に3つに分ける）
// ---------------------------------------------------------------------------
function extractThemes_(raw) {
  var themesArray = [];
  try {
    // 複雑な処理は廃止。AIが綺麗なJSONを返すので、そのまま読み込むだけです。
    var o = JSON.parse(String(raw).trim());
    if (o && o.themes && Array.isArray(o.themes)) {
      themesArray = o.themes;
    }
  } catch (e) {
    // 読み込みに失敗した時の保険
  }

  // 万が一2件しかなくても、空欄を補って必ず「3件のデータ」として画面に返します。
  return [
    String(themesArray[0] || ""),
    String(themesArray[1] || ""),
    String(themesArray[2] || "")
  ];
}

// ---------------------------------------------------------------------------
// マニュアル改定案（法令優先・現状補完のハイブリッド判定）
// ---------------------------------------------------------------------------
var REVISION_NECESSITY_VALUES = [
  "法律の変更に伴う改定",
  "自事業所の現状による改定",
  "両方",
  "今回は変更なし"
];

function handleRevisionRequest(data) {
  var facilityName = (data && data.facilityName) || "";
  var serviceType = (data && data.serviceType) || "";
  var situation = (data && (data.situation || data.currentSituation)) || "";
  var manualStorageUrl = (data && (data.manualLink || data.manualStorageUrl)) || "";
  var manualText = (data && (data.manualText || data.manualContent)) || "";

  if (!String(manualText).trim()) {
    return outJson_({
      ok: false,
      error: "マニュアルの内容が送られてきません。手順どおり、あらかじめ画面でマニュアルを読み込んでから、もう一度お試しください。"
    });
  }

  var key = (data && data.apiKey && String(data.apiKey).trim()) || PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) {
    return outJson_({
      ok: false,
      error: "職場の相談画面をつなぐための鍵（設定）がすぐわかりません。管理者の方にご相談ください。"
    });
  }

  var prompt = buildRevisionPrompt_(facilityName, serviceType, situation, manualStorageUrl, String(manualText).trim());

  try {
    var text = callGeminiForRevision_(key, prompt);
    var parsed = parseRevisionJsonFromGeminiText_(text);
    var necessity = parsed && parsed.necessity != null ? String(parsed.necessity).trim() : "";
    if (REVISION_NECESSITY_VALUES.indexOf(necessity) === -1) {
      necessity = "今回は変更なし";
    }
    var diffItems = parseRevisionDiffItems_(parsed && parsed.diffItems);
    if (diffItems.length === 0 && parsed && parsed.diffSummary != null && String(parsed.diffSummary).trim() !== "") {
      diffItems = parseRevisionDiffItems_(parsed.diffSummary);
    }
    var revision = {
      necessity: necessity,
      reason: parsed && parsed.reason != null ? String(parsed.reason).trim() : "",
      details: parsed && parsed.details != null ? String(parsed.details).trim() : "",
      verdict: parsed && parsed.verdict != null ? String(parsed.verdict).trim() : "",
      diffItems: diffItems,
      diffSummary: parsed && parsed.diffSummary != null ? String(parsed.diffSummary).trim() : "",
      concreteRevision: parsed && parsed.concreteRevision != null ? String(parsed.concreteRevision).trim() : ""
    };
    return outJson_({ ok: true, revision: revision });
  } catch (ex) {
    return outJson_({ ok: false, error: "分析の途中で問題が発生しました。時間をおいて、もう一度「改定案作成」を押してください。詳しい理由：" + String(ex && ex.message ? ex.message : ex) });
  }
}

/**
 * Google 検索ツール併用時は responseMimeType: JSON が使えないため、プレーンテキスト戻りから
 * ```json ... ``` ブロック、または先頭の { 〜 末尾の } までを抜き出して JSON として解釈する
 * @param {string} raw Gemini candidates から得た文字列
 * @return {Object}
 */
function parseRevisionJsonFromGeminiText_(raw) {
  var s = String(raw == null ? "" : raw);
  s = s.replace(/^\uFEFF/, "").trim();
  if (!s) {
    throw new Error("返答の本文が空でした。");
  }
  var toParse = s;
  var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1] != null) {
    toParse = String(fence[1]).trim();
  } else {
    var a = s.indexOf("{");
    var b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      toParse = s.substring(a, b + 1);
    }
  }
  toParse = String(toParse).trim();
  if (!toParse) {
    throw new Error("JSON として読み取れる箇所が見つかりませんでした。");
  }
  return JSON.parse(toParse);
}

/**
 * @param {Object} v diffItems 配列または null
 * @return {string[]}
 */
function parseRevisionDiffItems_(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map(function (s) {
        return String(s == null ? "" : s).trim();
      })
      .filter(function (s) {
        return s.length > 0;
      });
  }
  if (typeof v === "string") {
    return String(v)
      .split(/[\n\r]+/)
      .map(function (line) {
        return String(line)
          .replace(/^[・\-\*]\s*/, "")
          .trim();
      })
      .filter(function (s) {
        return s.length > 0;
      });
  }
  return [];
}

/**
 * マニュアル本文を含めた比較用プロンプト（法令／現状／現在の文書の三者比較）。
 * 1. 法令：ウェブ検索（組み込み）で公的情報の最新性を確かめる
 * 2. 現状：自事業所の記述
 * 3. 上記1・2に照らし【現在のマニュアル】を読み、要改定か判断
 */
function buildRevisionPrompt_(facilityName, serviceType, situation, manualStorageUrl, manualBody) {
  var fn = String(facilityName || "").trim() || "（未入力）";
  var st = String(serviceType || "").trim() || "（未入力）";
  var sit = String(situation || "").trim() || "（記載なし）";
  var url = String(manualStorageUrl || "").trim() || "（未入力）";

  var body = String(manualBody || "");
  if (body.length > 150000) {
    body = body.substring(0, 150000) + "\n\n（以降は文字数制限のため省略しています。必要ならマニュアルを章ごとに分けて再度お試しください。）\n";
  }

  return (
    "あなたは、次の2つを突き合わせて専門的に判断する担当です。\n" +
    "・手元にある【現在のマニュアル】の言葉と構成\n" +
    "・【法令・自事業所の現状】＝ ウェブ上の厚生労働省等の公的情報（最新の法改正・通知・報酬改定等）＋ 職場の状況\n\n" +
    "内蔵の Google によるウェブ参照機能を用いて、障害福祉分野（虐待防止・身体拘束の扱い・通報、報酬・加算 等）に関する**最新の公的情報**を可能な限り押さえたうえで、【現在のマニュアル】と照合してください。\n" +
    "比較の結論として、「今のマニュアルの文面のままで支障が少ないか」「追記・書き換えが望ましいか」を決めてください。\n\n" +
    "【厳守する判定の順序】\n" +
    "1. 法令・公的情報（先に最新を確認。マニュアルの文面に反映されていない要請が明確なら、改定を検討）\n" +
    "2. 1で必須の修正が不要と分かった場合に限り、【自事業所の現状】のうち重大なリスク要因（マニュアル不備に起因しうる事態）に絞り、改定の要否を検討\n" +
    "3. 1と2のどれにも当てはまらない → 「今回は変更なし」\n\n" +
    "【necessity に入れてよい4語句のいずれか1つ】\n" +
    "「法律の変更に伴う改定」／「自事業所の現状による改定」／「両方」／「今回は変更なし」\n\n" +
    "上記方針に従い、**次のキーのみ**を持つ1つのJSONを出力（前後の説明・改行制御に使う欄外の文字は出さない）。\n" +
    "necessity: 4語句のいずれか。\n" +
    "reason: 照合の根拠（公的情報の確認結果と、職場の事実）。\n" +
    "details: 補足。改定不要なら安心の一言でよい。\n" +
    "verdict: 読み手向け1行。例：「法律の点と職場の点のどちらからも、今回改めた方がよさそうです」／「今回は、今の文面のまま進めて大丈夫そうです」。\n" +
    "diffItems: 短い日本語文の**配列**。【現状との違い（要約）】の行ごと。配列が難しければ diffSummary に1本の要約文でもよい。\n" +
    "diffSummary: 任意。diffItems の代わりに1段でまとめてもよい。\n" +
    "concreteRevision: 【具体的な改定案】（書き換え例・追記文）。改定不要なら「特になし」。\n\n" +
    "【現在のマニュアル】\n" +
    body +
    "\n\n" +
    "【法令・現状】\n" +
    "事業所名: " +
    fn +
    "\nサービス種別: " +
    st +
    "\n自事業所の現状（職場の状況・困りごと）: " +
    sit +
    "\n共有用のメモ欄（リンク等）: " +
    url
  );
}

/**
 * マニュアル改定専用: Google 検索ツール併用（JSON mime は指定不可。本文はプレーンテキストで戻る）
 */
function callGeminiForRevision_(apiKey, userPrompt) {
  var url = GEMINI_URL + "?key=" + encodeURIComponent(apiKey);
  // Grounding with Google Search（Gemini API の組み込みツール）
  var payload = {
    contents: [{ parts: [{ text: userPrompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: 0.35
    }
  };
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) throw new Error("Gemini Error: " + body);

  var json = JSON.parse(body);
  var text =
    json &&
    json.candidates &&
    json.candidates[0] &&
    json.candidates[0].content &&
    json.candidates[0].content.parts &&
    json.candidates[0].content.parts[0] &&
    json.candidates[0].content.parts[0].text;
  if (!text) throw new Error("本文が取得できません。");
  return String(text);
}

// ---------------------------------------------------------------------------
// LINE: 従来フロー
// ---------------------------------------------------------------------------
/** 同一プロジェクトの Web アプリ（出欠フォーム doGet）のベースURL */
function getAttendanceWebAppUrl_() {
  try {
    return ScriptApp.getService().getUrl();
  } catch (e) {
    return "";
  }
}

function handleLineRequest(data) {
  var lineText = "【通知】委員会準備アプリからの連絡です。";
  if (data && data.date) {
    lineText = "虐待防止委員会 開催案内\n日時: " + String(data.date);
    if (data.location != null && String(data.location).trim() !== "") {
      lineText += "\n開催場所: " + String(data.location).trim();
    }
    var base = getAttendanceWebAppUrl_();
    if (base) {
      lineText +=
        "\n出欠のご回答はこちら:\n" +
        base +
        "?date=" +
        encodeURIComponent(String(data.date).trim());
    }
  } else if (data && data.message) lineText = String(data.message);

  try { sendLineMessage(lineText); } catch (err) {}
  return ContentService.createTextOutput("Success");
}

function outJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
