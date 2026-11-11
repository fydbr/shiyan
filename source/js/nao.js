/*!
 * 看板娘 · 友利奈绪
 * 立绘 + 漂浮 / 呼吸 / 视线跟随 / 点击台词
 * 纯本地资源，无外部依赖
 */
(function () {
  "use strict";

  var BP = 900;
  if (window.innerWidth <= BP) return;

  var KEY = "nao-widget-hidden";
  var POS_KEY = "nao-widget-pos";
  var LINES = [
    "我是你的恋人！……这句话，可不能反悔哦。",
    "学生会的工作，交给我就好。",
    "拉一下绳子就会热的牛舌便当，你想吃吗？",
    "星之海学园里，奇怪的家伙可不少呢。",
    "别一直盯着屏幕，眼睛会累的。",
    "今天写的这篇，勉强算及格吧。",
    "让身形从一个人眼中消失——所以，我只对你藏起来。",
    "摸鱼可以，别摸太久。",
    "ZHIEND 的新专辑，要不要一起听？",
    "你来了。我还以为今天你不会来。",
    "在这里站着，风里都是星星的味道。",
    "有事就说，我听着呢。",
    "拖一下我，就能换个地方站。",
    "这个位置不错吧？我挑的。",
  ];
  var GREET = {
    morning: "早上好。今天的星星还没落呢。",
    noon: "中午了，记得吃点东西。",
    afternoon: "下午了，来陪你写一会儿。",
    evening: "天黑了，星星出来了。",
    night: "这么晚还不睡？我陪你一会儿。",
  };

  function el(tag, id, cls) {
    var n = document.createElement(tag);
    if (id) n.id = id;
    if (cls) n.className = cls;
    return n;
  }

  function pick(a) {
    return a[Math.floor(Math.random() * a.length)];
  }

  function greetText() {
    var h = new Date().getHours();
    if (h >= 5 && h < 11) return GREET.morning;
    if (h >= 11 && h < 14) return GREET.noon;
    if (h >= 14 && h < 18) return GREET.afternoon;
    if (h >= 18 && h < 23) return GREET.evening;
    return GREET.night;
  }

  var widget, open, bubble, img, clsTimer, sayTimer;

  /* ---------- 语音（浏览器原生 TTS，无需外部接口） ---------- */
  var MUTE_KEY = "nao-widget-muted";
  var muted = false;
  var voice = null;

  function loadVoices() {
    if (!window.speechSynthesis) return;
    var list = window.speechSynthesis.getVoices() || [];
    if (!list.length) return;
    var zh = list.filter(function (v) {
      return /^zh([-_]|$)/i.test(v.lang) || /Chinese|中文|普通话/i.test(v.name);
    });
    if (!zh.length) {
      voice = null;
      return;
    }
    var pref = [
      "Xiaoxiao",
      "Xiaoyi",
      "Yunxi",
      "Huihui",
      "Yaoyao",
      "Tingting",
      "Meijia",
      "Sinji",
    ];
    var found = null;
    for (var i = 0; i < pref.length && !found; i++) {
      for (var j = 0; j < zh.length; j++) {
        if (zh[j].name.indexOf(pref[i]) >= 0) {
          found = zh[j];
          break;
        }
      }
    }
    voice = found || zh[0];
  }

  function setSpeaking(on) {
    if (widget) widget.classList.toggle("is-speaking", on);
  }

  function stopSpeak() {
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (err) {}
    }
    setSpeaking(false);
  }

  function speak(text) {
    if (muted) return;
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      u.rate = 1.02;
      u.pitch = 1.22;
      u.volume = 1;
      if (voice) u.voice = voice;
      u.onstart = function () {
        setSpeaking(true);
      };
      u.onend = function () {
        setSpeaking(false);
      };
      u.onerror = function () {
        setSpeaking(false);
      };
      window.speechSynthesis.speak(u);
    } catch (err) {}
  }

  function say(text, ms, silent) {
    if (!bubble) return;
    bubble.textContent = text;
    bubble.classList.add("is-on");
    clearTimeout(sayTimer);
    sayTimer = setTimeout(function () {
      bubble.classList.remove("is-on");
    }, ms || 5200);
    if (!silent) speak(text);
  }

  function bounce() {
    widget.classList.remove("is-bounce");
    void widget.offsetWidth;
    widget.classList.add("is-bounce");
    clearTimeout(clsTimer);
    clsTimer = setTimeout(function () {
      widget.classList.remove("is-bounce");
    }, 600);
  }

  /* ---------- 视线跟随 ---------- */
  var raf = null,
    target = { x: 0, r: 0 },
    cur = { x: 0, r: 0 },
    moving = false;

  function apply() {
    var dx = Math.abs(cur.x - target.x),
      dr = Math.abs(cur.r - target.r);
    if (dx < 0.02 && dr < 0.02) {
      cur.x = target.x;
      cur.r = target.r;
      moving = false;
    } else {
      cur.x += (target.x - cur.x) * 0.09;
      cur.r += (target.r - cur.r) * 0.09;
    }
    widget.style.transform =
      "translateX(" + cur.x.toFixed(2) + "px) rotate(" + cur.r.toFixed(2) + "deg)";
    if (moving) raf = requestAnimationFrame(apply);
    else raf = null;
  }

  function start() {
    if (raf || widget.classList.contains("is-hidden")) return;
    moving = true;
    raf = requestAnimationFrame(apply);
  }

  function onMove(e) {
    if (dg.active) return;
    var w = window.innerWidth || 1;
    var dx = (e.clientX - w / 2) / (w / 2);
    if (dx < -1) dx = -1;
    if (dx > 1) dx = 1;
    target.x = dx * -9;
    target.r = dx * -5.5;
    start();
  }

  /* ---------- 自由拖动 ---------- */
  var dg = { active: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0 };
  var pos = null;

  function vw() {
    return document.documentElement.clientWidth || window.innerWidth;
  }

  function vh() {
    return document.documentElement.clientHeight || window.innerHeight;
  }

  function clampPos(left, top) {
    var w = widget.offsetWidth || 96;
    var h = widget.offsetHeight || 150;
    return {
      left: Math.min(Math.max(2, left), Math.max(2, vw() - w - 2)),
      top: Math.min(Math.max(2, top), Math.max(2, vh() - h - 2)),
    };
  }

  /* 落位 + 气泡方向自动翻转 */
  function place(p, save) {
    if (!p) return;
    var c = clampPos(p.left, p.top);
    widget.style.left = c.left + "px";
    widget.style.top = c.top + "px";
    widget.style.bottom = "auto";
    widget.classList.add("is-placed");
    widget.classList.toggle("is-low", c.top < 190);
    widget.classList.toggle("is-left", c.left > vw() - 196);
    pos = c;
    if (save) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(c));
      } catch (err) {}
    }
  }

  function onDown(e) {
    if (e.button && e.button !== 0) return;
    if (e.target && e.target.id === "nao-close") return;
    var r = widget.getBoundingClientRect();
    dg.active = true;
    dg.moved = false;
    dg.sx = e.clientX;
    dg.sy = e.clientY;
    dg.ox = e.clientX - r.left;
    dg.oy = e.clientY - r.top;
    // 拖拽时冻结视线微摆，免得跟着抖
    target.x = 0;
    target.r = 0;
    cur.x = 0;
    cur.r = 0;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    widget.style.transform = "translateX(0px) rotate(0deg)";
    widget.classList.add("is-dragging");
    try {
      widget.setPointerCapture(e.pointerId);
    } catch (err) {}
  }

  function onDrag(e) {
    if (!dg.active) return;
    var dx = e.clientX - dg.sx;
    var dy = e.clientY - dg.sy;
    if (!dg.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 5) return;
      dg.moved = true;
    }
    var p = clampPos(e.clientX - dg.ox, e.clientY - dg.oy);
    widget.style.left = p.left + "px";
    widget.style.top = p.top + "px";
    widget.style.bottom = "auto";
    widget.classList.add("is-placed");
    widget.classList.toggle("is-low", p.top < 190);
    widget.classList.toggle("is-left", p.left > vw() - 196);
    pos = p;
    if (e.cancelable) e.preventDefault();
  }

  function onUp() {
    if (!dg.active) return;
    dg.active = false;
    widget.classList.remove("is-dragging");
    if (dg.moved) place(pos, true);
    // click 在 pointerup 之后同步触发，这里延后一拍再复位
    setTimeout(function () {
      dg.moved = false;
    }, 0);
  }

  function resetPos() {
    pos = null;
    try {
      localStorage.removeItem(POS_KEY);
    } catch (err) {}
    widget.classList.remove("is-placed", "is-low", "is-left");
    widget.style.left = "";
    widget.style.top = "";
    widget.style.bottom = "";
    say("回到老地方了。");
  }

  /* ---------- 挂载 ---------- */
  function build() {
    widget = el("div", "nao-widget");
    widget.innerHTML =
      '<div id="nao-bubble"></div>' +
      '<div class="nao-float"><div class="nao-breath">' +
      '<img id="nao-img" src="/images/nao.webp" alt="友利奈绪" draggable="false">' +
      "</div></div>" +
      '<button id="nao-voice" type="button" aria-label="开关语音"></button>' +
      '<button id="nao-close" type="button" aria-label="收起看板娘">×</button>';
    document.body.appendChild(widget);

    open = el("button", "nao-reopen");
    open.type = "button";
    open.textContent = "奈";
    open.setAttribute("aria-label", "唤出看板娘");
    document.body.appendChild(open);

    bubble = document.getElementById("nao-bubble");
    img = document.getElementById("nao-img");

    img.addEventListener("click", function () {
      if (dg.moved) return;
      bounce();
      say(pick(LINES));
    });

    /* 拖动：鼠标 / 触屏统一用 pointer 事件 */
    widget.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onDrag, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);

    /* 双击复位 */
    img.addEventListener("dblclick", function (e) {
      e.preventDefault();
      resetPos();
    });

    document.getElementById("nao-close").addEventListener("click", function (e) {
      e.stopPropagation();
      hide(true);
    });

    /* 语音开关 */
    var vbtn = document.getElementById("nao-voice");
    var ICON_ON =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19.5 6a9 9 0 0 1 0 12"/></svg>';
    var ICON_OFF =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/></svg>';

    function paintVoice() {
      if (!vbtn) return;
      vbtn.innerHTML = muted ? ICON_OFF : ICON_ON;
      vbtn.title = muted ? "开启语音" : "关闭语音";
      vbtn.setAttribute("aria-pressed", muted ? "false" : "true");
    }

    try {
      muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch (err) {
      muted = false;
    }
    paintVoice();

    if (vbtn) {
      vbtn.addEventListener("click", function (e) {
        e.stopPropagation();
        muted = !muted;
        try {
          localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
        } catch (err) {}
        paintVoice();
        if (muted) {
          stopSpeak();
          say("那我先安静一会儿。", 3600, true);
        } else {
          stopSpeak();
          setTimeout(function () {
            say("声音打开了，听得到吗？", 4200);
          }, 120);
        }
      });
    }

    loadVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
      setTimeout(loadVoices, 400);
    }

    open.addEventListener("click", function () {
      hide(false);
      say(pick(LINES));
    });

    document.addEventListener("mousemove", onMove, { passive: true });

    /* 还原上次拖到的位置 */
    try {
      var saved = localStorage.getItem(POS_KEY);
      if (saved) pos = JSON.parse(saved);
    } catch (err) {
      pos = null;
    }
    if (pos && typeof pos.left === "number") {
      place(pos, false);
      if (!img.complete) {
        img.addEventListener("load", function () {
          place(pos, false);
        });
      } else {
        setTimeout(function () {
          place(pos, false);
        }, 60);
      }
    }

    window.addEventListener("resize", function () {
      if (pos) place(pos, false);
    });
  }

  function hide(on) {
    if (!widget) return;
    widget.classList.toggle("is-hidden", on);
    open.classList.toggle("is-on", on);
    try {
      if (on) sessionStorage.setItem(KEY, "1");
      else sessionStorage.removeItem(KEY);
    } catch (err) {}
    if (on) {
      bubble.classList.remove("is-on");
      stopSpeak();
    } else {
      target.x = 0;
      target.r = 0;
      start();
    }
  }

  function boot() {
    var closed = false;
    try {
      closed = sessionStorage.getItem(KEY) === "1";
    } catch (err) {}

    build();

    if (closed) {
      hide(true);
      return;
    }

    setTimeout(function () {
      say(greetText(), 6000);
    }, 2600);
  }

  function ready() {
    if (document.body) boot();
    else document.addEventListener("DOMContentLoaded", boot);
  }

  // 首屏优先，看板娘延后加载，不抢渲染
  if (document.readyState === "complete") {
    setTimeout(ready, 600);
  } else {
    window.addEventListener("load", function () {
      setTimeout(ready, 600);
    });
  }
})();
