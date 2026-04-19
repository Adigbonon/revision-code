const bank = window.PDF_QUESTION_BANK || { count: 0, missing: [], questions: [] };
const questions = bank.questions;
const EXAM_SIZE = 40;
const ERROR_QUESTION_NUMBERS = new Set([123, 135, 187, 322, 323, 373, 584, 588, 592, 627, 634, 637]);
const CORRECTED_ANSWERS = {
  123: ["a", "c"],
  135: ["b"],
  187: ["a", "b", "c"],
  322: ["b"],
  323: ["a"],
  341: ["a"],
  349: ["a", "b", "d"],
  373: ["a", "b", "e"],
  414: ["a", "c"],
  518: ["c"],
  584: ["a", "b", "c"],
  588: ["a", "b", "d"],
  592: ["b", "c"],
  627: ["a", "b"],
  634: ["a", "b"],
  637: ["b"]
};

const flashcards = [
  {
    theme: "Signalisation",
    title: "Les quatre familles",
    text: "Verticale: panneaux. Horizontale: marques au sol. Lumineuse: feux. Agents: gestes et positions."
  },
  {
    theme: "Panneaux",
    title: "Panneaux de danger",
    text: "Ils annoncent un danger a l'avance. Ralentis, serre a droite et observe ce qui arrive."
  },
  {
    theme: "Priorites",
    title: "STOP et ceder le passage",
    text: "STOP: arret complet. Ceder le passage: ralentis et laisse passer les usagers prioritaires."
  },
  {
    theme: "Feux",
    title: "Jaune clignotant",
    text: "Il demande la prudence. Applique le panneau present ou, a defaut, la priorite a droite."
  },
  {
    theme: "Agents",
    title: "Agent de circulation",
    text: "De profil, tu passes. De face ou de dos, tu t'arretes. Les signes de l'agent priment."
  },
  {
    theme: "Conduite",
    title: "Avant un virage",
    text: "Ralentis avant le virage, tiens ta droite et evite les manoeuvres brusques."
  }
];

const state = {
  currentQuestion: null,
  currentPool: [],
  selected: new Set(),
  answered: false,
  flashcardIndex: 0,
  exam: {
    active: false,
    questions: [],
    position: 0,
    correct: 0,
    answered: 0
  },
  stats: JSON.parse(localStorage.getItem("codeRevisionStats") || '{"answered":0,"correct":0,"streak":0,"mistakes":[],"today":0,"date":""}')
};

const $ = (selector) => document.querySelector(selector);
const categorySelect = $("#category-select");
const modeSelect = $("#mode-select");
const searchInput = $("#question-search");
const searchButton = $("#search-button");
const questionTheme = $("#question-theme");
const questionIndex = $("#question-index");
const questionText = $("#question-text");
const answerList = $("#answer-list");
const feedback = $("#feedback");
const errataNote = $("#errata-note");
const mediaPanel = $("#media-panel");
const validateButton = $("#validate-button");
const nextButton = $("#next-button");
const newQuestionButton = $("#new-question-button");
const flashcardButton = $("#flashcard-button");
const flashcard = $("#flashcard");
const resetButton = $("#reset-button");
const saveStatus = $("#save-status");
const exportProgressButton = $("#export-progress-button");
const importProgressInput = $("#import-progress-input");

function setup() {
  if (!questions.length) {
    questionText.textContent = "Aucune question n'a ete chargee.";
    return;
  }

  applyCorrections();

  const themes = [...new Set(questions.map((question) => question.theme))].sort();
  for (const theme of themes) {
    const option = document.createElement("option");
    option.value = theme;
    option.textContent = theme;
    categorySelect.append(option);
  }

  refreshDay();
  updateStats();
  renderFlashcard();
  startMode();
}

function applyCorrections() {
  for (const question of questions) {
    question.explain = "";
  }

  for (const question of questions) {
    const correctedLetters = CORRECTED_ANSWERS[question.number];
    if (!correctedLetters) continue;

    question.correct = correctedLetters
      .map((letter) => letter.toLowerCase().charCodeAt(0) - 97)
      .filter((index) => index >= 0 && index < question.answers.length);
    question.corrected = true;
  }
}

function refreshDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.stats.date !== today) {
    state.stats.date = today;
    state.stats.today = 0;
    saveStats();
  }
}

function saveStats() {
  localStorage.setItem("codeRevisionStats", JSON.stringify(state.stats));
  updateSaveStatus("Progression sauvegardée sur cet appareil.");
}

function updateSaveStatus(message) {
  if (saveStatus) saveStatus.textContent = message;
}

function getBasePool() {
  const selectedTheme = categorySelect.value;
  return selectedTheme === "all"
    ? questions
    : questions.filter((question) => question.theme === selectedTheme);
}

function getQuestionPool() {
  const base = getBasePool();
  if (modeSelect.value !== "mistakes") return base;

  const mistakeIds = new Set(state.stats.mistakes);
  return base.filter((question) => mistakeIds.has(question.number));
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function startMode() {
  state.exam.active = modeSelect.value === "exam";
  if (state.exam.active) {
    const pool = getBasePool();
    state.exam.questions = shuffle(pool).slice(0, Math.min(EXAM_SIZE, pool.length));
    state.exam.position = 0;
    state.exam.correct = 0;
    state.exam.answered = 0;
    state.currentQuestion = state.exam.questions[0];
  } else {
    state.exam.questions = [];
    startSequentialPool();
    return;
  }

  state.selected = new Set();
  state.answered = false;
  renderQuestion();
  updateExamStatus();
}

function startSequentialPool() {
  const pool = getQuestionPool().slice().sort((a, b) => a.number - b.number);
  state.currentPool = pool;
  if (!pool.length) {
    state.currentQuestion = null;
    questionTheme.textContent = "Mes erreurs";
    questionIndex.textContent = "";
    questionText.textContent = "Aucune erreur à revoir";
    answerList.innerHTML = "";
    mediaPanel.innerHTML = "";
    mediaPanel.hidden = true;
    feedback.hidden = true;
    validateButton.hidden = true;
    return;
  }
  state.currentQuestion = pool[0];
  state.selected = new Set();
  state.answered = false;
  renderQuestion();
  updateExamStatus();
}

function showQuestion(question) {
  state.currentQuestion = question;
  state.selected = new Set();
  state.answered = false;
  renderQuestion();
  updateExamStatus();
}

function goToQuestion(number) {
  const question = questions.find((item) => item.number === number);
  if (!question) {
    feedback.hidden = false;
    feedback.className = "feedback bad";
    feedback.textContent = `Question ${number} introuvable dans le texte extrait du PDF.`;
    return;
  }

  state.exam.active = false;
  modeSelect.value = "normal";
  categorySelect.value = "all";
  state.currentPool = getQuestionPool().slice().sort((a, b) => a.number - b.number);
  showQuestion(question);
}

function renderQuestion() {
  const question = state.currentQuestion;
  if (!question) return;

  questionTheme.textContent = question.theme;
  questionIndex.textContent = `Question ${question.number}`;
  questionText.textContent = question.text;
  feedback.hidden = true;
  feedback.className = "feedback";
  errataNote.hidden = true;
  errataNote.textContent = "";
  renderMedia(question);
  validateButton.disabled = false;
  validateButton.hidden = false;
  answerList.innerHTML = "";

  question.answers.forEach((answer, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer";
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `<span class="letter">${String.fromCharCode(65 + index)}</span><span>${answer}</span>`;
    button.addEventListener("click", () => toggleAnswer(index, button));
    answerList.append(button);
  });
}

function renderMedia(question) {
  const media = [...new Set(question.media || [])];
  const shouldShow = media.length > 0 && /image|dessin|panneau|intersection|passage|niveau|agent|vehicule|véhicule|voiture|camion|moto|volant|mains|schéma|schema|moteur|roues|PN\d|Im|D\d/i.test(question.text);

  mediaPanel.innerHTML = "";
  mediaPanel.hidden = !shouldShow;
  if (!shouldShow) return;

  media.forEach((src, index) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = `Illustration de la question ${question.number}, image ${index + 1}`;
    img.loading = "lazy";
    mediaPanel.append(img);
  });
}

function toggleAnswer(index, button) {
  if (state.answered) return;

  if (state.selected.has(index)) {
    state.selected.delete(index);
    button.setAttribute("aria-pressed", "false");
  } else {
    state.selected.add(index);
    button.setAttribute("aria-pressed", "true");
  }
}

function validateAnswer() {
  if (state.answered || state.selected.size === 0) return;

  const question = state.currentQuestion;
  const correctSet = new Set(question.correct);
  const isCorrect = question.correct.length === state.selected.size
    && question.correct.every((index) => state.selected.has(index));

  state.answered = true;
  validateButton.disabled = true;
  validateButton.hidden = true;

  [...answerList.children].forEach((button, index) => {
    if (correctSet.has(index)) button.classList.add("correct");
    if (state.selected.has(index) && !correctSet.has(index)) button.classList.add("wrong");
  });

  state.stats.answered += 1;
  state.stats.today += 1;

  if (isCorrect) {
    state.stats.correct += 1;
    state.stats.streak += 1;
    state.stats.mistakes = state.stats.mistakes.filter((number) => number !== question.number);
    state.currentPool = state.currentPool.filter((item) => item.number !== question.number || modeSelect.value !== "mistakes");
  } else {
    state.stats.streak = 0;
    if (!state.stats.mistakes.includes(question.number)) {
      state.stats.mistakes.push(question.number);
    }
  }

  if (state.exam.active) {
    state.exam.answered += 1;
    if (isCorrect) state.exam.correct += 1;
  }

  feedback.hidden = false;
  feedback.classList.add(isCorrect ? "good" : "bad");
  feedback.textContent = isCorrect ? "Bonne réponse" : "Mauvaise réponse";

  saveStats();
  updateStats();
  updateExamStatus();
}

function nextQuestion() {
  if (!state.exam.active) {
    const freshPool = getQuestionPool().slice().sort((a, b) => a.number - b.number);
    const pool = modeSelect.value === "mistakes" ? freshPool : (state.currentPool.length ? state.currentPool : freshPool);
    state.currentPool = pool;
    if (!pool.length) {
      feedback.hidden = false;
      feedback.className = "feedback good";
      feedback.textContent = "Toutes les erreurs sont corrigées";
      return;
    }
    const currentIndex = pool.findIndex((question) => question.number === state.currentQuestion?.number);
    const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    showQuestion(pool[nextIndex] || pool[0]);
    return;
  }

  if (state.exam.position + 1 >= state.exam.questions.length) {
    feedback.hidden = false;
    feedback.className = "feedback good";
    feedback.textContent = `Mini examen termine: ${state.exam.correct}/${state.exam.questions.length}. Relance le mode Mini examen pour une nouvelle serie.`;
    updateExamStatus();
    return;
  }

  state.exam.position += 1;
  state.currentQuestion = state.exam.questions[state.exam.position];
  state.selected = new Set();
  state.answered = false;
  renderQuestion();
  updateExamStatus();
}

function updateStats() {
  $("#answered-count").textContent = state.stats.answered;
  $("#streak-count").textContent = state.stats.streak;
  const rate = state.stats.answered ? Math.round((state.stats.correct / state.stats.answered) * 100) : 0;
  $("#success-rate").textContent = `${rate}%`;
  $("#goal-ring").textContent = `${Math.min(state.stats.today, 20)}/20`;
}

function updateExamStatus() {
  return;
}

function renderFlashcard() {
  const card = flashcards[state.flashcardIndex % flashcards.length];
  flashcard.innerHTML = `<span>${card.theme}</span><h3>${card.title}</h3><p>${card.text}</p>`;
}

function resetProgress() {
  state.stats = {
    answered: 0,
    correct: 0,
    streak: 0,
    mistakes: [],
    today: 0,
    date: new Date().toISOString().slice(0, 10)
  };
  saveStats();
  updateStats();
  startMode();
}

function exportProgress() {
  const payload = {
    app: "revision-code-route",
    version: 1,
    savedAt: new Date().toISOString(),
    stats: state.stats
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "progression-code-route.json";
  link.click();
  URL.revokeObjectURL(url);
  updateSaveStatus("Progression exportée.");
}

function importProgress(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!payload.stats || typeof payload.stats !== "object") {
        throw new Error("Fichier invalide");
      }

      state.stats = {
        answered: Number(payload.stats.answered) || 0,
        correct: Number(payload.stats.correct) || 0,
        streak: Number(payload.stats.streak) || 0,
        mistakes: Array.isArray(payload.stats.mistakes) ? payload.stats.mistakes.map(Number).filter(Boolean) : [],
        today: Number(payload.stats.today) || 0,
        date: payload.stats.date || new Date().toISOString().slice(0, 10)
      };
      saveStats();
      updateStats();
      startMode();
      updateSaveStatus("Progression importée sur cet appareil.");
    } catch {
      updateSaveStatus("Import impossible: fichier non reconnu.");
    } finally {
      importProgressInput.value = "";
    }
  });
  reader.readAsText(file);
}

validateButton.addEventListener("click", validateAnswer);
nextButton.addEventListener("click", nextQuestion);
newQuestionButton.addEventListener("click", startMode);
categorySelect.addEventListener("change", startMode);
modeSelect.addEventListener("change", startMode);
flashcardButton.addEventListener("click", () => {
  state.flashcardIndex += 1;
  renderFlashcard();
});
resetButton.addEventListener("click", resetProgress);
exportProgressButton.addEventListener("click", exportProgress);
importProgressInput.addEventListener("change", () => importProgress(importProgressInput.files[0]));
function runSearch() {
  const number = Number(searchInput.value);
  if (number > 0) goToQuestion(number);
}

searchButton.addEventListener("click", runSearch);
searchInput.addEventListener("change", runSearch);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runSearch();
  }
});

setup();
