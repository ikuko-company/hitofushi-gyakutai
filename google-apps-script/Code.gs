/**
 * 委員会準備 Web アプリ — 完全統合版
 *
 * - POST { "action": "generateThemes", "facilityName", "serviceType", "situation", "apiKey"?, "systemPrompt"? }
 *   → Gemini（apiKey は HTML 送信を最優先、なければスクリプトプロパティ GEMINI_API_KEY）
 * - POST { "date": "..." } その他（action なし） → LINE 送信（従来・no-cors 想定）
 *
 * デプロイ: Web アプリとして公開（誰でもアクセス可 / 匿名可にする場合は execute as you）
 */

var GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

// ---------------------------------------------------------------------------
// LINE送信の心臓部（そのまま移植）
// ---------------------------------------------------------------------------
function sendLineMessage(message) {
  const CHANNEL_ACCESS_TOKEN =
    "xzH6qeMiBvo6TfarYw8Zf5z2idc0HhCo2OWA0EMZsD+qWrrCswvPMmBrwct5y+ZNgm4jcRtpuuS1TNsB0/uX1Li0NpQzMll3rzsRVqAxY9MmGd9I1PSui/hD0MWcMzwbS5v8vxaxdHDS3pxrXxMKUwdB04t89/1O/w1cDnyilFU=";
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
// エントリ
// ---------------------------------------------------------------------------
function doPost(e) {
  var data;
  try {
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      data = {};
    }
  } catch (err) {
    return ContentService.createTextOutput("Success");
  }

  if (data && data.action === "generateThemes") {
    return handleAiRequest(data);
  }

  return handleLineRequest(data);
}

// ---------------------------------------------------------------------------
// AI: テーマ3件（JSON 返却・CORS 利用クライアント向け）
// ---------------------------------------------------------------------------
function handleAiRequest(data) {
  var res = handleAiRequestCore_(data);
  return outJson_(res);
}

function handleAiRequestCore_(data) {
  var name = (data && data.facilityName) || "";
  var stype = (data && data.serviceType) || "";
  var situation = (data && data.situation) || "";
  var systemHint = (data && data.systemPrompt) || "";

  var key =
    (data && data.apiKey && String(data.apiKey).trim()) ||
    PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) {
    return {
      ok: false,
      error:
        "Gemini API キーがありません。事業者設定の API キーを送るか、スクリプトプロパティ GEMINI_API_KEY を設定してください。",
    };
  }

  var prompt = buildThemePrompt_(name, stype, situation, systemHint);

  try {
    var text = callGeminiFlash_(key, prompt);
    var themes = extractThemesAsJsonOrLines_(text);
    return { ok: true, raw: text, themes: themes };
  } catch (ex) {
    return { ok: false, error: String(ex && ex.message ? ex.message : ex) };
  }
}

/**
 * 事業所名・サービス種別を反映し、3件の専門的なテーマを JSON 形式で返答させる
 */
function buildThemePrompt_(facilityName, serviceType, situation, systemPrompt) {
  return (
    (systemHintSection(systemPrompt) +
      "あなたは障害福祉・児童福祉領域の「虐待防止委員会」に関する専門アシスタントです。\n" +
      "次の事業所に特化し、専門的で実行可能な委員会の議題テーマ案を、日本語で「ちょうど3件」提案してください。\n" +
      "各テーマは具体的かつ1文で60文字以内を目安にしてください。\n\n" +
      "【事業所名】" +
      (facilityName || "（未設定）") +
      "\n" +
      "【サービス種別】" +
      (serviceType || "（未設定）") +
      "\n" +
      "【自事業所の気になること・現状】\n" +
      (String(situation).trim() || "（特に記載なし）") +
      "\n\n" +
      "最終的な回答は、次の JSON オブジェクト「のみ」出力してください。説明文やコードフェンス、前後の文字は一切付けないでください。\n" +
      '{"themes":["テーマ案1（文字列）","テーマ案2（文字列）","テーマ案3（文字列）"]}\n' +
      "キー名は themes 固定。配列の要素数は必ず3です。"
  );
}

function systemHintSection(systemPrompt) {
  if (!systemPrompt || !String(systemPrompt).trim()) return "";
  return "【追加の方針・制約（事業所設定）】\n" + String(systemPrompt).trim() + "\n\n";
}

// ---------------------------------------------------------------------------
// LINE: 従来フロー（no-cors 向け シンプルな "Success" 応答）
// ---------------------------------------------------------------------------
function handleLineRequest(data) {
  var lineText = buildLineMessageText_(data);
  try {
    sendLineMessage(lineText);
  } catch (err) {
    // 送信失敗時も 200+Success のまま返す方針（従来クライアント互換）ならここを変更可
  }
  return ContentService.createTextOutput("Success");
}

function buildLineMessageText_(data) {
  if (data == null) return "【通知】日時情報を受信しました。";
  if (data.date != null && String(data.date) !== "")
    return "虐待防止委員会 開催案内\n日時: " + String(data.date);
  if (data.message != null && String(data.message) !== "") return String(data.message);
  return "【通知】委員会準備アプリからの連絡です。";
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------
function callGeminiFlash_(apiKey, userPrompt) {
  var url = GEMINI_URL + "?key=" + encodeURIComponent(apiKey);
  var payload = {
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.55,
      maxOutputTokens: 1024,
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
  if (code < 200 || code >= 300) {
    throw new Error("Gemini HTTP " + code + " " + body);
  }
  var json = JSON.parse(body);
  var text =
    json &&
    json.candidates &&
    json.candidates[0] &&
    json.candidates[0].content &&
    json.candidates[0].content.parts &&
    json.candidates[0].content.parts[0] &&
    json.candidates[0].content.parts[0].text;
  if (!text) {
    throw new Error("Gemini から本文を取得できません: " + body);
  }
  return String(text);
}

/**
 * まず JSON { themes: [...] } を抽出、ダメなら番号行パース
 * @return {string[]}
 */
function extractThemesAsJsonOrLines_(raw) {
  var s = String(raw).trim();
  // ```json ... ``` 除去
  var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  try {
    var o = JSON.parse(s);
    if (o && o.themes && Array.isArray(o.themes) && o.themes.length >= 3) {
      return [String(o.themes[0] || ""), String(o.themes[1] || ""), String(o.themes[2] || "")];
    }
  } catch (e) {
    // 部分 JSON 探索
    var m = s.match(/\{[\s\S]*"themes"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
    if (m) {
      try {
        var o2 = JSON.parse(m[0]);
        if (o2.themes && o2.themes.length >= 3) {
          return [String(o2.themes[0] || ""), String(o2.themes[1] || ""), String(o2.themes[2] || "")];
        }
      } catch (e2) {}
    }
  }
  return parseThreeThemesFromText_(s);
}

function parseThreeThemesFromText_(raw) {
  var lines = String(raw)
    .split(/\r?\n/)
    .map(function (l) {
      return l.trim();
    })
    .filter(function (l) {
      return l;
    });
  var themes = [];
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^\d+\.\s*(.+)$/);
    if (m) themes.push(m[1].trim());
    if (themes.length >= 3) break;
  }
  if (themes.length < 3) {
    themes = lines.slice(0, 3);
  }
  while (themes.length < 3) {
    themes.push("");
  }
  return [themes[0] || "", themes[1] || "", themes[2] || ""];
}

function outJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
