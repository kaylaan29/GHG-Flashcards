// ============================================================
// 온실가스관리기사 실기 플래시카드 — app.js
// ============================================================

const DATA_FILES = [
  { part: "PART 01", file: "data/part1.json" },
  { part: "PART 02", file: "data/part2.json" },
  { part: "PART 03", file: "data/part3.json" },
  { part: "PART 04", file: "data/part4.json" }
];

const STORAGE_KEY = "ghg-flashcards-progress-v1";

let chapters = [];        // [{id, part, section, title, totalQuestions, missingQuestions, cards:[...]}]
let progress = {};        // { cardId: "right" | "wrong" }
let currentChapterId = null;
let currentDeck = [];      // array of card objects currently shown (order matters, shuffled or not)
let currentIndex = 0;
let wrongFilterActive = false;
let isFlipped = false;
let justJudged = false;    // prevents skipping straight to next card's answer accidentally

// ---------- Persistence ----------
function loadProgress(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    progress = raw ? JSON.parse(raw) : {};
  }catch(e){
    progress = {};
  }
}
function saveProgress(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }catch(e){ /* ignore quota errors */ }
}

// ---------- Data loading ----------
async function loadAllData(){
  const results = await Promise.all(DATA_FILES.map(async (entry) => {
    try{
      const res = await fetch(entry.file);
      if(!res.ok) throw new Error("HTTP " + res.status + " " + res.statusText);
      const text = await res.text();
      let json;
      try{
        json = JSON.parse(text);
      }catch(parseErr){
        throw new Error("JSON 파싱 오류: " + parseErr.message + " (파일 길이: " + text.length + "자)");
      }
      return {
        id: entry.file,
        part: json.part || entry.part,
        section: json.section || "",
        title: json.title || "",
        totalQuestions: json.totalQuestions || (json.cards ? json.cards.length : 0),
        missingQuestions: json.missingQuestions || [],
        cards: json.cards || []
      };
    }catch(err){
      console.error("Failed to load", entry.file, err);
      return {
        id: entry.file,
        part: entry.part,
        section: "",
        title: "(로드 실패)",
        totalQuestions: 0,
        missingQuestions: [],
        cards: [],
        loadError: true,
        errorMessage: err && err.message ? err.message : String(err)
      };
    }
  }));
  chapters = results;
}

// ---------- Helpers ----------
function allCardsFlat(){
  return chapters.flatMap(ch => ch.cards);
}

function getChapterById(id){
  return chapters.find(c => c.id === id);
}

function computeChapterStats(chapter){
  let right = 0, wrong = 0, unseen = 0;
  chapter.cards.forEach(card => {
    const state = progress[card.id];
    if(state === "right") right++;
    else if(state === "wrong") wrong++;
    else unseen++;
  });
  return { right, wrong, unseen, total: chapter.cards.length };
}

function shuffleArray(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1800);
}

// ---------- Rendering: sidebar ----------
function renderSidebar(){
  const list = document.getElementById("chapterList");
  list.innerHTML = "";

  const byPart = {};
  chapters.forEach(ch => {
    if(!byPart[ch.part]) byPart[ch.part] = [];
    byPart[ch.part].push(ch);
  });

  Object.keys(byPart).forEach(partName => {
    const group = document.createElement("div");
    group.className = "part-group";

    const title = document.createElement("div");
    title.className = "part-group-title";
    title.textContent = partName;
    group.appendChild(title);

    byPart[partName].forEach(ch => {
      const stats = computeChapterStats(ch);
      const pct = stats.total ? Math.round(((stats.right + stats.wrong) / stats.total) * 100) : 0;

      const btn = document.createElement("button");
      btn.className = "chapter-btn" + (ch.id === currentChapterId ? " active" : "");
      btn.style.setProperty("--p", pct);
      if(ch.loadError){
        btn.innerHTML = `
          <span class="ring"></span>
          <span class="label">
            <span class="name">${escapeHtml(ch.section || ch.title)} ⚠️</span>
            <span class="count" style="color:var(--wrong);">로드 실패 — 탭해서 에러 보기</span>
          </span>
        `;
      } else {
        btn.innerHTML = `
          <span class="ring"></span>
          <span class="label">
            <span class="name">${escapeHtml(ch.section || ch.title)}</span>
            <span class="count">${stats.right + stats.wrong}/${stats.total} 학습 · ${stats.right}맞음 ${stats.wrong}틀림</span>
          </span>
        `;
      }
      btn.addEventListener("click", () => selectChapter(ch.id));
      group.appendChild(btn);
    });

    list.appendChild(group);
  });

  const totalCards = allCardsFlat().length;
  const totalDone = allCardsFlat().filter(c => progress[c.id]).length;
  document.getElementById("totalStat").textContent =
    `전체 ${totalCards}문항 · ${totalDone}문항 학습`;
}

function escapeHtml(str){
  if(!str) return "";
  return str.replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[m]));
}

// ---------- Chapter selection ----------
function selectChapter(chapterId){
  currentChapterId = chapterId;
  wrongFilterActive = false;
  document.getElementById("wrongFilterBtn").classList.remove("active");
  buildDeck();
  closeSidebarMobile();
  renderSidebar();
}

function buildDeck(shuffled){
  const ch = getChapterById(currentChapterId);
  if(!ch) return;
  let cards = ch.cards.slice();
  if(wrongFilterActive){
    cards = cards.filter(c => progress[c.id] === "wrong");
  }
  if(shuffled){
    cards = shuffleArray(cards);
  }
  currentDeck = cards;
  currentIndex = 0;
  isFlipped = false;
  renderMainHeader();
  renderCard();
}

function toggleWrongFilter(){
  if(!currentChapterId){
    showToast("먼저 챕터를 선택하세요");
    return;
  }
  wrongFilterActive = !wrongFilterActive;
  document.getElementById("wrongFilterBtn").classList.toggle("active", wrongFilterActive);
  buildDeck();
  if(wrongFilterActive && currentDeck.length === 0){
    showToast("이 챕터에는 틀린 문제가 없습니다");
  }
}

// ---------- Main header / progress ----------
function renderMainHeader(){
  const ch = getChapterById(currentChapterId);
  const header = document.getElementById("mainHeader");
  if(!ch){
    header.style.display = "none";
    return;
  }
  header.style.display = "block";

  const label = wrongFilterActive ? `${ch.section || ch.title} · 틀린 문제만` : (ch.section || ch.title);
  document.getElementById("chapterTitle").textContent = label;

  const stats = computeChapterStats(ch);
  const baseTotal = wrongFilterActive ? currentDeck.length : stats.total;
  const rightPct = baseTotal ? (stats.right / stats.total) * 100 : 0;
  const wrongPct = baseTotal ? (stats.wrong / stats.total) * 100 : 0;

  document.getElementById("segRight").style.width = (wrongFilterActive ? 0 : rightPct) + "%";
  document.getElementById("segWrong").style.width = (wrongFilterActive ? 0 : wrongPct) + "%";

  const posInDeck = currentDeck.length ? Math.min(currentIndex + 1, currentDeck.length) : 0;
  document.getElementById("progressCount").textContent = `${posInDeck} / ${currentDeck.length}`;

  document.getElementById("countRight").textContent = stats.right;
  document.getElementById("countWrong").textContent = stats.wrong;
  document.getElementById("countUnseen").textContent = stats.unseen;
}

// ---------- Card rendering ----------
function renderCard(){
  const zone = document.getElementById("cardZone");

  if(!currentChapterId){
    zone.innerHTML = `
      <div class="empty-state">
        <h3>챕터를 선택하세요</h3>
        <p>왼쪽 사이드바에서 학습할 챕터를 선택하면 카드가 표시됩니다.</p>
      </div>`;
    return;
  }

  if(currentDeck.length === 0){
    const ch = getChapterById(currentChapterId);
    if(ch && ch.loadError){
      zone.innerHTML = `
        <div class="empty-state">
          <h3>⚠️ 데이터 로드 실패</h3>
          <p style="word-break:break-all; text-align:left; background:#fbe9e6; padding:12px; border-radius:8px; font-family:monospace; font-size:12px;">
            파일: ${escapeHtml(ch.id)}<br><br>
            에러: ${escapeHtml(ch.errorMessage || "알 수 없는 오류")}
          </p>
        </div>`;
      return;
    }
    zone.innerHTML = `
      <div class="empty-state">
        <h3>${wrongFilterActive ? "틀린 문제가 없습니다" : "카드가 없습니다"}</h3>
        <p>${wrongFilterActive ? "모든 문제를 맞히셨거나 아직 틀린 기록이 없습니다." : "이 챕터에는 표시할 카드가 없습니다."}</p>
      </div>`;
    return;
  }

  const card = currentDeck[currentIndex];
  const state = progress[card.id]; // "right" | "wrong" | undefined

  zone.innerHTML = `
    <div class="card-outer">
      <div class="card" id="flipCard">
        <div class="card-face front" id="cardFront">
          <span class="card-tag">${card.id}</span>
          <div class="card-side-label">문제</div>
          <div class="card-body">${renderRichContent(card.q)}</div>
          <div class="card-hint">탭하거나 Space를 눌러 정답 확인</div>
        </div>
      </div>
    </div>
    <div class="judge-row" id="judgeRow" style="visibility:hidden;">
      <button class="judge-btn incorrect" id="btnWrong">✗ 틀림</button>
      <button class="judge-btn correct" id="btnRight">✓ 맞음</button>
    </div>
    <div class="nav-row">
      <button class="nav-btn" id="prevBtn" aria-label="이전">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="nav-center">
        <button class="icon-btn" id="shuffleBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg><span>셔플</span></button>
      </div>
      <button class="nav-btn" id="nextBtn" aria-label="다음">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  `;

  isFlipped = false;
  attachCardEvents(card);
  renderKatexIn(zone);
  document.getElementById("prevBtn").disabled = currentIndex === 0;
  document.getElementById("nextBtn").disabled = currentIndex === currentDeck.length - 1;
  renderMainHeader();
}

function attachCardEvents(card){
  const flipCard = document.getElementById("flipCard");
  flipCard.addEventListener("click", () => toggleFlip(card));

  document.getElementById("prevBtn").addEventListener("click", goPrev);
  document.getElementById("nextBtn").addEventListener("click", goNext);
  document.getElementById("shuffleBtn").addEventListener("click", shuffleDeck);
}

function toggleFlip(card){
  if(isFlipped){
    flipToFront(card);
  } else {
    flipToBack(card);
  }
}

function flipToFront(card){
  isFlipped = false;
  const cardEl = document.getElementById("flipCard");
  cardEl.innerHTML = `
    <div class="card-face front" id="cardFront">
      <span class="card-tag">${card.id}</span>
      <div class="card-side-label">문제</div>
      <div class="card-body">${renderRichContent(card.q)}</div>
      <div class="card-hint">탭하거나 Space를 눌러 정답 확인</div>
    </div>
  `;
  const judgeRow = document.getElementById("judgeRow");
  judgeRow.style.visibility = "hidden";
}

function flipToBack(card){
  isFlipped = true;
  const state = progress[card.id];

  const cardEl = document.getElementById("flipCard");
  cardEl.innerHTML = `
    <div class="card-face back" id="cardBack">
      <span class="card-tag">${card.id}</span>
      <div class="card-side-label">정답</div>
      <div class="card-body">${renderRichContent(card.a)}</div>
      ${renderDiagram(card)}
      ${renderTable(card)}
      ${renderLatex(card.latex)}
      <div class="card-hint">탭하거나 Space를 눌러 문제 다시 보기</div>
    </div>
  `;
  renderKatexIn(cardEl);

  const judgeRow = document.getElementById("judgeRow");
  judgeRow.style.visibility = "visible";
  document.getElementById("btnRight").classList.toggle("selected", state === "right");
  document.getElementById("btnWrong").classList.toggle("selected", state === "wrong");
  document.getElementById("btnRight").addEventListener("click", (e) => { e.stopPropagation(); judge(card, "right"); });
  document.getElementById("btnWrong").addEventListener("click", (e) => { e.stopPropagation(); judge(card, "wrong"); });
}

function judge(card, verdict){
  progress[card.id] = verdict;
  saveProgress();
  document.getElementById("btnRight").classList.toggle("selected", verdict === "right");
  document.getElementById("btnWrong").classList.toggle("selected", verdict === "wrong");
  renderSidebar();
  renderMainHeader();
  // auto-advance after short delay, landing safely on the FRONT of next card
  setTimeout(() => {
    if(currentIndex < currentDeck.length - 1){
      goNext();
    } else {
      showToast("이 챕터의 마지막 카드입니다");
    }
  }, 280);
}

function goNext(){
  if(currentIndex < currentDeck.length - 1){
    currentIndex++;
    renderCard(); // renderCard always renders the FRONT first — prevents answer leaking
  }
}
function goPrev(){
  if(currentIndex > 0){
    currentIndex--;
    renderCard();
  }
}
function shuffleDeck(){
  currentDeck = shuffleArray(currentDeck);
  currentIndex = 0;
  renderCard();
  showToast("카드를 섞었습니다");
}

// ---------- Rich content rendering (text + tables + latex + diagrams) ----------
function renderRichContent(text){
  if(!text) return "";
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function renderTable(card){
  if(!card.table) return "";
  const t = card.table;
  let html = '<div class="k-table-wrap"><table class="k-table"><thead><tr>';
  t.headers.forEach(h => html += `<th>${escapeHtml(h)}</th>`);
  html += "</tr></thead><tbody>";
  t.rows.forEach(row => {
    html += "<tr>";
    row.forEach(cell => html += `<td>${escapeHtml(cell)}</td>`);
    html += "</tr>";
  });
  html += "</tbody></table>";
  if(t.note){
    html += `<div class="k-table-note">${escapeHtml(t.note)}</div>`;
  }
  html += "</div>";
  return html;
}

function renderLatex(latex){
  if(!latex) return "";
  return `<div class="k-latex" data-latex="${encodeURIComponent(latex)}"></div>`;
}

function renderDiagram(card){
  if(!card.diagram) return "";
  const d = card.diagram;

  if(d.type === "monitoring-flow"){
    // Simple linear case: single node -> target (e.g. WH -> 배출시설)
    if(d.nodes && d.nodes.length === 1 && d.target){
      const n = d.nodes[0];
      return `<div class="k-diagram">
        ${d.boundary ? `<div style="text-align:center;font-size:11px;margin-bottom:10px;color:var(--ink-soft);">[ ${escapeHtml(d.boundary)} ]</div>` : ""}
        <div class="diag-flow">
          <div class="diag-box${n.includes('점선') ? ' dashed' : ''}">${escapeHtml(n)}</div>
          <span class="diag-arrow">→</span>
          <div class="diag-box target">${escapeHtml(d.target)}</div>
        </div>
      </div>`;
    }
    // Branching case (one source fanning out to multiple FL -> 배출시설 pairs)
    // or anything more complex: render a clear branch diagram using the structure text
    // plus a simplified visual if nodes look like [WH, FL, FL...]
    if(d.nodes && d.nodes.length > 1){
      const source = d.nodes[0];
      const branches = d.nodes.slice(1);
      let branchHtml = '<div class="diag-branch">';
      branchHtml += `<div class="diag-box">${escapeHtml(source)}</div>`;
      branchHtml += '<div class="diag-branch-lines">';
      branches.forEach(b => {
        branchHtml += `<div class="diag-branch-row">
          <span class="diag-branch-connector">└▶</span>
          <div class="diag-box${b.includes('점선') ? ' dashed' : ''}">${escapeHtml(b)}</div>
          <span class="diag-arrow">→</span>
          <div class="diag-box target">배출시설</div>
        </div>`;
      });
      branchHtml += '</div></div>';
      return `<div class="k-diagram">
        ${d.boundary ? `<div style="text-align:center;font-size:11px;margin-bottom:10px;color:var(--ink-soft);">[ ${escapeHtml(d.boundary)} ]</div>` : ""}
        ${branchHtml}
        ${d.structure ? `<div class="diag-text">${escapeHtml(d.structure)}</div>` : ""}
      </div>`;
    }
    // Fallback: text-only structure description
    return `<div class="k-diagram">
      ${d.boundary ? `<div style="text-align:center;font-size:11px;margin-bottom:10px;color:var(--ink-soft);">[ ${escapeHtml(d.boundary)} ]</div>` : ""}
      ${d.structure ? `<div class="diag-text">${escapeHtml(d.structure)}</div>` : ""}
    </div>`;
  }

  if(d.type === "process-flow" && d.steps){
    let stepsHtml = "";
    d.steps.forEach((s, i) => {
      stepsHtml += `<div class="diag-step"><div class="step-title">${escapeHtml(s.title)}</div><div class="step-desc">${escapeHtml(s.desc)}</div></div>`;
      if(i < d.steps.length - 1) stepsHtml += `<div class="diag-step-arrow">→</div>`;
    });
    return `<div class="k-diagram"><div class="diag-steps">${stepsHtml}</div></div>`;
  }

  if(d.type === "org-tree" && d.levels){
    let levelsHtml = "";
    d.levels.forEach((level, i) => {
      levelsHtml += `<div class="org-level${level.side ? ' org-level-side' : ''}">`;
      level.nodes.forEach(n => {
        levelsHtml += `<div class="org-node">${escapeHtml(n)}</div>`;
      });
      if(level.note){
        levelsHtml += `<div class="org-note">${escapeHtml(level.note)}</div>`;
      }
      levelsHtml += `</div>`;
      if(i < d.levels.length - 1 && !d.levels[i+1].side){
        levelsHtml += `<div class="org-connector">│</div>`;
      }
    });
    return `<div class="k-diagram">
      ${d.title ? `<div style="text-align:center;font-size:12px;font-weight:700;margin-bottom:10px;color:var(--accent-dark);">${escapeHtml(d.title)}</div>` : ""}
      <div class="org-tree">${levelsHtml}</div>
    </div>`;
  }

  if(d.type === "facility-flow"){
    return `<div class="k-diagram"><div class="diag-text">${escapeHtml(d.structure || "")}</div></div>`;
  }

  if(d.type === "line-graph"){
    return `<div class="k-diagram">
      <div class="diag-graph">
        <svg viewBox="0 0 360 220" xmlns="http://www.w3.org/2000/svg">
          <line x1="40" y1="190" x2="340" y2="190" stroke="#9a948a" stroke-width="1.5"/>
          <line x1="40" y1="190" x2="40" y2="20" stroke="#9a948a" stroke-width="1.5"/>
          <polyline points="40,70 340,140" fill="none" stroke="#2f6f4f" stroke-width="2.5"/>
          <polyline points="40,120 340,170" fill="none" stroke="#54625a" stroke-width="2" stroke-dasharray="6,4"/>
          <text x="345" y="143" font-size="11" fill="#2f6f4f">(가)</text>
          <text x="190" y="100" font-size="11" fill="#54625a">(나)</text>
          <text x="345" y="173" font-size="11" fill="#54625a">(다)</text>
          <text x="30" y="205" font-size="10" fill="#9a948a" text-anchor="middle">사업시작</text>
          <text x="335" y="205" font-size="10" fill="#9a948a" text-anchor="end">인정기간 종료</text>
        </svg>
        <div style="font-size:11px;color:var(--ink-soft);text-align:center;">${escapeHtml(d.xAxis||"")} / ${escapeHtml(d.yAxis||"")}</div>
        ${d.structure ? `<div class="diag-text">${escapeHtml(d.structure)}</div>` : ""}
      </div>
    </div>`;
  }

  return "";
}

function renderKatexIn(container){
  if(typeof katex === "undefined") return;
  container.querySelectorAll(".k-latex[data-latex]").forEach(el => {
    const raw = decodeURIComponent(el.getAttribute("data-latex"));
    try{
      katex.render(raw, el, { throwOnError: false, displayMode: true });
    }catch(e){
      el.textContent = raw;
    }
  });
}

// ---------- Reset ----------
function openResetModal(){
  document.getElementById("resetModal").classList.add("show");
}
function closeResetModal(){
  document.getElementById("resetModal").classList.remove("show");
}
function doReset(){
  progress = {};
  saveProgress();
  closeResetModal();
  renderSidebar();
  if(currentChapterId){
    buildDeck();
  }
  showToast("진행상황을 초기화했습니다");
}

// ---------- Mobile sidebar ----------
function openSidebarMobile(){
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebarBackdrop").classList.add("show");
}
function closeSidebarMobile(){
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarBackdrop").classList.remove("show");
}

// ---------- Keyboard shortcuts ----------
function handleKeydown(e){
  if(!currentChapterId || currentDeck.length === 0) return;
  // avoid interfering with typing in inputs (none currently, but safe-guard)
  if(e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  const card = currentDeck[currentIndex];

  switch(e.key){
    case " ":
    case "Spacebar":
      e.preventDefault();
      toggleFlip(card);
      break;
    case "ArrowLeft":
      e.preventDefault();
      goPrev();
      break;
    case "ArrowRight":
      e.preventDefault();
      goNext();
      break;
    case "1":
      if(isFlipped){
        judge(card, "right");
      }
      break;
    case "2":
      if(isFlipped){
        judge(card, "wrong");
      }
      break;
  }
}

// ---------- Init ----------
async function init(){
  await loadAllData();
  renderSidebar();

  document.getElementById("menuToggle").addEventListener("click", openSidebarMobile);
  document.getElementById("sidebarBackdrop").addEventListener("click", closeSidebarMobile);
  document.getElementById("wrongFilterBtn").addEventListener("click", toggleWrongFilter);
  document.getElementById("resetBtn").addEventListener("click", openResetModal);
  document.getElementById("cancelReset").addEventListener("click", closeResetModal);
  document.getElementById("confirmReset").addEventListener("click", doReset);
  document.addEventListener("keydown", handleKeydown);

  // auto-select first chapter with content for convenience
  const firstUsable = chapters.find(c => c.cards.length > 0);
  if(firstUsable){
    selectChapter(firstUsable.id);
  }
}

loadProgress();
init();
