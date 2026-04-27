/**
 * 委員会準備 Web アプリ — シンプル・安定版
 */

var GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/** 出欠回答の追記先スプレッドシート（スクリプトと同一の Google アカウントでアクセス可能であること） */
const ATTENDANCE_SHEET_ID = "17S6cuRmOPDA949VNnFrcq1qrndRyBAOIWtQYoX8XOfQ";

// ---------------------------------------------------------------------------
// Web: 出欠フォーム（GET）— プロジェクト内に HTML ファイル「attendance_form」を配置すること
// ---------------------------------------------------------------------------
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile("attendance_form")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setTitle("虐待防止委員会 出欠のご回答");
}

// ---------------------------------------------------------------------------
// LINE送信処理
// ---------------------------------------------------------------------------
function sendLineMessage(message) {
  const CHANNEL_ACCESS_TOKEN = "xzH6qeMiBvo6TfarYw8Zf5z2idc0HhCo2OWA0EMZsD+qWrrCswvPMmBrwct5y+ZNgm4jcRtpuuS1TNsB0/uX1Li0NpQzMll3rzsRVqAxY9MmGd9I1PSui/hD0MWcMzwbS5v8vxaxdHDS3pxrXxMKUwdB04t89/1O/w1cDnyilFU=";
  const USER_ID = "U4984fb2d4ed2f6f66e03245cf9b08d78";
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
  return handleLineRequest(data);
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
