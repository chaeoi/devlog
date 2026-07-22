const page = document.body.dataset.page;
const INDEX_PATH = "assets/index.json";
const state = {
  projects: null,
  docs: {},
  log: {},
  cache: new Map(),
  inflight: new Map(),
  textCache: new Map(),
  textInflight: new Map(),
};

initPage();

async function initPage() {
  if (page === "docs") {
    await setupProjectView({
      type: "docs",
      containerId: "docsProjects",
      contentId: "docsContent",
      autoBottom: false,
      autoTop: true,
      onRendered: () => buildToc(document.getElementById("docsContent"), document.getElementById("docsToc")),
    });
    return;
  }

  if (page === "log") {
    initLogControls();
    await setupProjectView({
      type: "log",
      containerId: "logProjects",
      contentId: "logContent",
      autoBottom: true,
      renderer: loadLogView,
    });
  }
}

async function setupProjectView({ type, containerId, contentId, autoBottom, autoTop, onRendered, renderer }) {
  const container = document.getElementById(containerId);
  const content = document.getElementById(contentId);
  if (!container || !content) return;

  setPlaceholder(content, "正在加载项目列表…");

  try {
    if (!state.projects) state.projects = await loadProjectIndex();
    const list = state.projects[type] || [];

    if (!list.length) {
      setPlaceholder(content, "未找到项目文件");
      return;
    }

    state[type].list = list;
    const renderItem = (item) => {
      if (typeof renderer === "function") {
        renderer(item.file, content);
      } else {
        loadMarkdown(item.file, content, { autoBottom, autoTop, onRendered });
      }
    };

    renderProjectButtons(container, list, (item) => {
      state[type].active = item.file;
      renderItem(item);
    });

    state[type].active = list[0].file;
    renderItem(list[0]);
    if (!renderer) {
      scheduleIdle(() => preloadMarkdown(list.map((item) => item.file), list[0].file));
    }
  } catch (error) {
    setPlaceholder(content, `加载失败：${error.message}`);
  }
}

function renderProjectButtons(container, list, onSelect) {
  container.innerHTML = "";
  list.forEach((item, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    if (index === 0) btn.classList.add("chip--active");
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      container.querySelectorAll(".chip").forEach((c) => c.classList.remove("chip--active"));
      btn.classList.add("chip--active");
      onSelect(item);
    });
    container.appendChild(btn);
  });
}

function initLogControls() {
  const startDate = document.getElementById("logStartDate");
  const completeDate = document.getElementById("logCompleteDate");
  const assignee = document.getElementById("logAssignee");
  const group = document.getElementById("logGroup");
  const status = document.getElementById("logStatus");
  if (!startDate || !completeDate || !assignee || !group || !status) return;
  state.log.controls = { startDate, completeDate, assignee, group, status };
  syncDateEmpty(startDate);
  syncDateEmpty(completeDate);
  initDatePicker(startDate);
  initDatePicker(completeDate);
  state.log.filters = {
    startDate: startDate.value || "",
    completeDate: completeDate.value || "",
    assignee: assignee.value || "all",
    group: group.value || "all",
    status: status.value || "all",
  };
  const onChange = () => {
    state.log.filters = {
      startDate: startDate.value,
      completeDate: completeDate.value,
      assignee: assignee.value,
      group: group.value,
      status: status.value,
    };
    renderLogContent();
  };
  const startHandler = () => {
    syncDateEmpty(startDate);
    onChange();
  };
  const completeHandler = () => {
    syncDateEmpty(completeDate);
    onChange();
  };
  startDate.addEventListener("input", startHandler);
  startDate.addEventListener("change", startHandler);
  completeDate.addEventListener("input", completeHandler);
  completeDate.addEventListener("change", completeHandler);
  [assignee, group, status].forEach((select) => {
    select.addEventListener("change", onChange);
  });
}

function initDatePicker(input) {
  const wrapper = input.closest(".log-control__date");
  const button = wrapper?.querySelector(".log-control__button");
  if (!wrapper || !button) return;

  const picker = buildDatePicker();
  wrapper.appendChild(picker.root);
  const filterKey = input.id === "logStartDate" ? "startDate" : "completeDate";
  const stateEntry = {
    ...picker,
    wrapper,
    button,
    input,
    filterKey,
    viewDate: new Date(),
  };
  state.log.datePicker = stateEntry;

  picker.prev.addEventListener("click", () => {
    stateEntry.viewDate.setMonth(stateEntry.viewDate.getMonth() - 1);
    renderDatePicker(stateEntry);
  });
  picker.next.addEventListener("click", () => {
    stateEntry.viewDate.setMonth(stateEntry.viewDate.getMonth() + 1);
    renderDatePicker(stateEntry);
  });
  picker.clear.addEventListener("click", () => {
    setDateValue(stateEntry, "");
    closeDatePicker(stateEntry);
  });
  picker.grid.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-date]");
    if (!target || target.disabled) return;
    setDateValue(stateEntry, target.dataset.date || "");
    closeDatePicker(stateEntry);
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    toggleDatePicker(stateEntry);
  });
  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) closeDatePicker(stateEntry);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDatePicker(stateEntry);
  });

  const initial = parseInputDate(input.value, false) || new Date();
  stateEntry.viewDate = new Date(initial.getFullYear(), initial.getMonth(), 1);
  renderDatePicker(stateEntry);
}

function buildDatePicker() {
  const root = document.createElement("div");
  root.className = "log-date-picker";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-hidden", "true");

  const header = document.createElement("div");
  header.className = "log-date-picker__header";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "log-date-picker__nav";
  prev.setAttribute("aria-label", "上一月");
  prev.textContent = "‹";
  const title = document.createElement("div");
  title.className = "log-date-picker__title";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "log-date-picker__nav";
  next.setAttribute("aria-label", "下一月");
  next.textContent = "›";
  header.appendChild(prev);
  header.appendChild(title);
  header.appendChild(next);

  const weekdays = document.createElement("div");
  weekdays.className = "log-date-picker__weekdays";
  ["一", "二", "三", "四", "五", "六", "日"].forEach((label) => {
    const span = document.createElement("span");
    span.textContent = label;
    weekdays.appendChild(span);
  });

  const grid = document.createElement("div");
  grid.className = "log-date-picker__grid";

  const actions = document.createElement("div");
  actions.className = "log-date-picker__actions";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "log-date-picker__clear";
  clear.textContent = "清除";
  actions.appendChild(clear);

  root.appendChild(header);
  root.appendChild(weekdays);
  root.appendChild(grid);
  root.appendChild(actions);

  return { root, title, grid, prev, next, clear };
}

function toggleDatePicker(stateEntry) {
  if (stateEntry.root.classList.contains("is-open")) {
    closeDatePicker(stateEntry);
    return;
  }
  const selected = parseInputDate(stateEntry.input.value, false) || new Date();
  stateEntry.viewDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
  renderDatePicker(stateEntry);
  openDatePicker(stateEntry);
}

function openDatePicker(stateEntry) {
  stateEntry.root.classList.add("is-open");
  stateEntry.root.setAttribute("aria-hidden", "false");
}

function closeDatePicker(stateEntry) {
  stateEntry.root.classList.remove("is-open");
  stateEntry.root.setAttribute("aria-hidden", "true");
}

function renderDatePicker(stateEntry) {
  const year = stateEntry.viewDate.getFullYear();
  const month = stateEntry.viewDate.getMonth();
  stateEntry.title.textContent = `${year}年${month + 1}月`;
  stateEntry.grid.innerHTML = "";
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const selectedValue = stateEntry.input.value;
  const todayValue = formatDateValue(new Date());
  const totalCells = 42;

  for (let i = 0; i < totalCells; i += 1) {
    const day = i - offset + 1;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "log-date-picker__day";
    if (day < 1 || day > daysInMonth) {
      cell.classList.add("is-muted");
      cell.disabled = true;
      if (day < 1) {
        cell.textContent = String(daysInPrevMonth + day);
      } else {
        cell.textContent = String(day - daysInMonth);
      }
    } else {
      const value = formatDateValue(new Date(year, month, day));
      cell.dataset.date = value;
      cell.textContent = String(day);
      if (value === todayValue) cell.classList.add("is-today");
      if (value === selectedValue) cell.classList.add("is-selected");
    }
    stateEntry.grid.appendChild(cell);
  }
}

function setDateValue(stateEntry, value) {
  stateEntry.input.value = value;
  if (state.log.filters) {
    state.log.filters[stateEntry.filterKey] = value;
  }
  syncDateEmpty(stateEntry.input);
  renderLogContent();
}

function syncDateEmpty(input) {
  if (!input) return;
  const wrapper = input.closest(".log-control__date") || input;
  const text = wrapper.querySelector(".log-control__text");
  if (text) {
    text.textContent = input.value ? formatDateLabel(input.value) : "年/月/日";
  }
  wrapper.classList.toggle("is-empty", !input.value);
}

function formatDateLabel(value) {
  return value.replace(/-/g, "/");
}

function formatDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function loadLogView(path, target) {
  state.log.target = target;
  setPlaceholder(target, "正在加载日志…");
  try {
    const markdown = await getMarkdownText(path);
    const data = parseLogMarkdown(markdown);
    state.log.data = data;
    updateAssigneeOptions(data.entries);
    renderLogContent();
  } catch (error) {
    setPlaceholder(target, `加载失败：${error.message}`);
  }
}

function renderLogContent() {
  const target = state.log.target;
  const data = state.log.data;
  if (!target || !data) return;
  const filters = state.log.filters || {
    startDate: "",
    completeDate: "",
    assignee: "all",
    group: "all",
    status: "all",
  };
  const filtered = applyLogFilters(data.entries, filters);
  const sorted = sortEntriesByStart(filtered);
  const summary = buildLogSummary(sorted);
  const groups = buildLogGroups(sorted, filters);
  const title = data.title || "日志";
  const html = buildLogHtml(title, summary, groups);
  target.innerHTML = html;
  target.scrollTop = 0;
}

function getMarkdownText(path) {
  if (state.textCache.has(path)) return Promise.resolve(state.textCache.get(path));
  if (state.textInflight.has(path)) return state.textInflight.get(path);
  const task = fetchText(path)
    .then((markdown) => {
      state.textCache.set(path, markdown);
      state.textInflight.delete(path);
      return markdown;
    })
    .catch((error) => {
      state.textInflight.delete(path);
      throw error;
    });
  state.textInflight.set(path, task);
  return task;
}

function parseLogMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const entries = [];
  let title = "";
  let index = 0;
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("# ")) {
      title = line.replace(/^#\s+/, "").trim();
      return;
    }
    if (line.startsWith("---")) return;
    const entry = parseLogLine(line, index);
    if (entry) {
      entries.push(entry);
      index += 1;
    }
  });
  return { title, entries };
}

function parseLogLine(line, index) {
  const headMatch = line.match(/^- \[(x| )\]\s+(.+)$/i);
  if (!headMatch) return null;
  const done = headMatch[1].toLowerCase() === "x";
  const body = headMatch[2].trim();
  const parts = body.split(/\s+\|\s+/);
  if (parts.length < 3) return null;
  const timePartIndex = isTimePart(parts[0]) ? 0 : parts.length - 1;
  if (!isTimePart(parts[timePartIndex])) return null;
  const timePart = parts[timePartIndex];
  const timeMatch = timePart.match(/(?:开始|创建):([^\s]+)\s+完成:([^\s]+)/i);
  if (!timeMatch) return null;
  const createdText = normalizeDateText(timeMatch[1]);
  const completedText = normalizeDateText(timeMatch[2]);
  const title = timePartIndex === 0 ? parts[1].trim() : parts[0].trim();
  const assigneeText = timePartIndex === 0 ? parts.slice(2).join(" | ").trim() : parts.slice(1, -1).join(" | ").trim();
  const assignees = assigneeText
    ? assigneeText.split(/[，,、]/).map((name) => name.trim()).filter(Boolean)
    : [];
  const normalizedAssignees = assignees.length ? assignees : ["未分配"];
  return {
    index,
    done,
    title,
    assignees: normalizedAssignees,
    createdText,
    completedText,
    createdAt: parseDate(createdText),
    completedAt: parseDate(completedText),
  };
}

function isTimePart(value) {
  return /(?:开始|创建):[^\s]+\s+完成:[^\s]+/i.test(value);
}

function normalizeDateText(value) {
  if (!value) return "-";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "未定") return "-";
  return trimmed.replace(/\./g, "-");
}

function parseDate(value) {
  if (!value || value === "-") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function updateAssigneeOptions(entries) {
  const controls = state.log.controls;
  if (!controls || !controls.assignee) return;
  const assignees = collectAssignees(entries);
  const previous = controls.assignee.value || "all";
  controls.assignee.innerHTML = '<option value="all">全部</option>';
  assignees.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    controls.assignee.appendChild(option);
  });
  controls.assignee.value = assignees.includes(previous) ? previous : "all";
  state.log.filters.assignee = controls.assignee.value;
}

function collectAssignees(entries) {
  const names = [];
  const seen = new Set();
  entries.forEach((entry) => {
    entry.assignees.forEach((name) => {
      if (seen.has(name)) return;
      seen.add(name);
      names.push(name);
    });
  });
  return names.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function applyLogFilters(entries, filters) {
  const startRange = buildUpperBound(filters.startDate);
  const completedRange = buildLowerBound(filters.completeDate);
  return entries.filter((entry) => {
    if (filters.status === "done" && !entry.done) return false;
    if (filters.status === "todo" && entry.done) return false;
    if (filters.assignee !== "all" && !entry.assignees.includes(filters.assignee)) return false;
    if (!isDateInRange(entry.createdAt, startRange)) return false;
    if (!isDateInRange(entry.completedAt, completedRange)) return false;
    return true;
  });
}

function parseInputDate(value, isEnd) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (isEnd) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

function buildLowerBound(value) {
  const start = parseInputDate(value, false);
  if (!start) return { start: null, end: null };
  return { start, end: null };
}

function buildUpperBound(value) {
  const end = parseInputDate(value, true);
  if (!end) return { start: null, end: null };
  return { start: null, end };
}

function isDateInRange(date, range) {
  if (!range.start && !range.end) return true;
  if (!date) return false;
  if (range.start && date < range.start) return false;
  if (range.end && date > range.end) return false;
  return true;
}

function sortEntriesByStart(entries) {
  return entries.slice().sort((a, b) => {
    const aTime = a.createdAt ? a.createdAt.getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.createdAt ? b.createdAt.getTime() : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return a.index - b.index;
  });
}

function buildLogSummary(entries) {
  const total = entries.length;
  const done = entries.filter((entry) => entry.done).length;
  return { total, done, todo: total - done };
}

function buildLogGroups(entries, filters) {
  if (!entries.length) return [];
  if (filters.group === "person") {
    const groups = new Map();
    const names = filters.assignee === "all" ? collectAssignees(entries) : [filters.assignee];
    names.forEach((name) => {
      groups.set(name, []);
    });
    entries.forEach((entry) => {
      entry.assignees.forEach((name) => {
        if (!groups.has(name)) return;
        groups.get(name).push(entry);
      });
    });
    return Array.from(groups.entries()).map(([title, groupEntries]) => ({
      title,
      entries: groupEntries.slice().sort((a, b) => a.index - b.index),
    }));
  }
  return [{ title: "全部", entries: entries.slice() }];
}

function buildLogHtml(title, summary, groups) {
  const header = `
    <div class="log-header">
      <h1>${escapeHtml(title)}</h1>
      <div class="log-meta">
        <span class="log-badge">共 ${summary.total} 项</span>
        <span class="log-badge log-badge--done">已完成 ${summary.done}</span>
        <span class="log-badge log-badge--todo">进行中 ${summary.todo}</span>
      </div>
    </div>
  `;
  if (!groups.length) {
    return `<div class="log-view">${header}<p class="placeholder">暂无匹配的日志</p></div>`;
  }
  const groupHtml = groups
    .map((group) => {
      const groupDone = group.entries.filter((entry) => entry.done).length;
      const groupTotal = group.entries.length;
      const items = group.entries.map((entry) => renderLogItem(entry)).join("");
      return `
        <section class="log-group">
          <div class="log-group__header">
            <h2>${escapeHtml(group.title)}</h2>
            <span class="log-group__count">已完成 ${groupDone} / ${groupTotal}</span>
          </div>
          <div class="log-items">${items}</div>
        </section>
      `;
    })
    .join("");
  return `<div class="log-view">${header}<div class="log-groups">${groupHtml}</div></div>`;
}

function renderLogItem(entry) {
  const statusClass = entry.done ? "log-item__status log-item__status--done" : "log-item__status";
  const statusText = entry.done ? "已完成" : "进行中";
  const createdLabel = entry.createdText === "-" ? "未定" : entry.createdText;
  const completedLabel = entry.completedText === "-" ? "未定" : entry.completedText;
  const assignees = entry.assignees.join(", ");
  return `
    <article class="log-item${entry.done ? " log-item--done" : ""}">
      <div class="log-item__main">
        <span class="${statusClass}">${statusText}</span>
        <div class="log-item__title">${applyInline(entry.title)}</div>
      </div>
      <div class="log-item__meta">
        <span>开始 ${escapeHtml(createdLabel)}</span>
        <span>完成 ${escapeHtml(completedLabel)}</span>
        <span>负责人 ${escapeHtml(assignees || "未分配")}</span>
      </div>
    </article>
  `;
}

async function loadMarkdown(path, target, options = {}) {
  try {
    const html = await getMarkdownHtml(path);
    target.innerHTML = html;
    if (options.autoTop) scrollToTop(target);
    if (options.autoBottom) scrollToBottom(target);
    if (typeof options.onRendered === "function") {
      requestAnimationFrame(() => options.onRendered());
    }
  } catch (error) {
    setPlaceholder(target, `加载失败：${error.message}`);
  }
}

function getMarkdownHtml(path) {
  if (state.cache.has(path)) return Promise.resolve(state.cache.get(path));
  if (state.inflight.has(path)) return state.inflight.get(path);
  const task = fetchText(path)
    .then((markdown) => {
      const html = markdownToHtml(markdown);
      state.cache.set(path, html);
      state.inflight.delete(path);
      return html;
    })
    .catch((error) => {
      state.inflight.delete(path);
      throw error;
    });
  state.inflight.set(path, task);
  return task;
}

function preloadMarkdown(files, activeFile) {
  const queue = files.filter((file) => file && file !== activeFile);
  if (!queue.length) return;
  const run = () => {
    if (!queue.length) return;
    const next = queue.shift();
    getMarkdownHtml(next).finally(() => scheduleIdle(run));
  };
  scheduleIdle(run);
}

function scheduleIdle(task) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(task, { timeout: 1200 });
  } else {
    setTimeout(task, 120);
  }
}

function setPlaceholder(el, text) {
  el.innerHTML = `<p class="placeholder">${text}</p>`;
}

function scrollToBottom(el) {
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
    setTimeout(() => {
      el.scrollTop = el.scrollHeight;
    }, 50);
  });
}

function scrollToTop(el) {
  requestAnimationFrame(() => {
    el.scrollTop = 0;
  });
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function loadProjectIndex() {
  const raw = await fetchJson(INDEX_PATH);
  if (raw && typeof raw === "object") {
    return {
      docs: normalizeList(raw.docs),
      log: normalizeList(raw.log),
    };
  }
  return { docs: [], log: [] };
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (item && typeof item === "object" && item.file) return buildEntry(item.file, item.label || "");
      return null;
    })
    .filter(Boolean);
}

function buildEntry(file, label) {
  return {
    file,
    label: label || toTitle(file),
  };
}

function buildToc(contentEl, tocEl) {
  if (!tocEl || !contentEl) return;
  const headings = Array.from(contentEl.querySelectorAll("h1, h2, h3, h4"));
  tocEl.innerHTML = "";
  if (!headings.length) {
    tocEl.innerHTML = '<p class="placeholder">无目录</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  const items = [];
  const lastIndexByLevel = {
    1: null,
    2: null,
  };
  headings.forEach((heading) => {
    if (!heading.id) return;
    const level = Number(heading.tagName.slice(1));
    const row = document.createElement("div");
    row.className = `toc__row toc__row--h${level}`;
    if (level >= 3) row.classList.add("toc__row--hidden");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toc__toggle toc__toggle--empty";
    toggle.setAttribute("aria-hidden", "true");
    toggle.tabIndex = -1;
    const a = document.createElement("a");
    a.href = `#${heading.id}`;
    a.textContent = heading.textContent || heading.id;
    a.className = `toc__item toc__item--h${level}`;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveToc(items, a, setSectionExpanded);
    });
    row.appendChild(toggle);
    row.appendChild(a);
    frag.appendChild(row);
    const entry = {
      anchor: a,
      heading,
      level,
      row,
      parentIndex: null,
      childIndexes: null,
      toggle,
    };
    items.push(entry);
    if (level === 1) {
      lastIndexByLevel[1] = items.length - 1;
      lastIndexByLevel[2] = null;
    } else if (level === 2) {
      lastIndexByLevel[2] = items.length - 1;
    } else {
      entry.parentIndex = lastIndexByLevel[2] ?? lastIndexByLevel[1];
    }
  });
  const childrenMap = new Map();
  items.forEach((entry, index) => {
    if (entry.parentIndex == null) return;
    const list = childrenMap.get(entry.parentIndex) || [];
    list.push(index);
    childrenMap.set(entry.parentIndex, list);
  });
  const setSectionExpanded = (parentIndex, expand) => {
    const parentEntry = items[parentIndex];
    if (!parentEntry || !parentEntry.childIndexes || !parentEntry.toggle) return;
    parentEntry.toggle.setAttribute("aria-expanded", expand ? "true" : "false");
    parentEntry.row.classList.toggle("toc__row--expanded", expand);
    parentEntry.childIndexes.forEach((childIndex) => {
      const childEntry = items[childIndex];
      if (!childEntry) return;
      childEntry.row.classList.toggle("toc__row--hidden", !expand);
    });
  };
  childrenMap.forEach((childIndexes, parentIndex) => {
    const parentEntry = items[parentIndex];
    if (!parentEntry) return;
    parentEntry.childIndexes = childIndexes;
    const toggle = parentEntry.toggle;
    if (!toggle) return;
    toggle.classList.remove("toc__toggle--empty");
    toggle.removeAttribute("aria-hidden");
    toggle.removeAttribute("tabindex");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "展开子目录");
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      setSectionExpanded(parentIndex, !expanded);
    });
  });
  tocEl.appendChild(frag);
  attachTocSync(contentEl, items, setSectionExpanded);
}

function attachTocSync(contentEl, items, setSectionExpanded) {
  if (!items.length) return;
  const update = () => {
    const scrollTop = contentEl.scrollTop;
    const base = contentEl.getBoundingClientRect().top;
    let current = items[0].anchor;
    for (const item of items) {
      const offset = item.heading.getBoundingClientRect().top - base + scrollTop;
      if (offset <= scrollTop + 24) current = item.anchor;
      else break;
    }
    setActiveToc(items, current, setSectionExpanded);
  };
  contentEl.addEventListener("scroll", update, { passive: true });
  update();
}

function setActiveToc(items, activeAnchor, setSectionExpanded) {
  let activeEntry = null;
  items.forEach((item) => {
    const isActive = item.anchor === activeAnchor;
    item.anchor.classList.toggle("is-active", isActive);
    if (isActive) activeEntry = item;
  });
  if (activeEntry && activeEntry.parentIndex != null && typeof setSectionExpanded === "function") {
    setSectionExpanded(activeEntry.parentIndex, true);
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHref(href) {
  if (!href) return "#";
  const trimmed = href.trim();
  if (/^javascript:/i.test(trimmed)) return "#";
  return trimmed.replace(/"/g, "%22");
}

function applyInline(text) {
  const codes = [];
  let prepared = text.replace(/`([^`]+)`/g, (_, code) => {
    const key = `__CODE_${codes.length}__`;
    codes.push({ key, code: escapeHtml(code) });
    return key;
  });

  prepared = escapeHtml(prepared);
  prepared = prepared.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  prepared = prepared.replace(/\*(.+?)\*/g, "<em>$1</em>");
  prepared = prepared.replace(/~~(.+?)~~/g, "<s>$1</s>");
  prepared = prepared.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
    return `<a href="${sanitizeHref(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  codes.forEach(({ key, code }) => {
    prepared = prepared.replace(key, `<code>${code}</code>`);
  });

  return prepared;
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const usedSlugs = {};
  let inCode = false;
  let codeLines = [];
  let listType = null;
  let listBuffer = [];

  const flushList = () => {
    if (listType && listBuffer.length) {
      html.push(`<${listType}>${listBuffer.join("")}</${listType}>`);
    }
    listType = null;
    listBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (inCode) {
      if (line.startsWith("```")) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
        codeLines = [];
      } else {
        codeLines.push(raw);
      }
      continue;
    }

    if (line.startsWith("```")) {
      flushList();
      inCode = true;
      codeLines = [];
      continue;
    }

    if (!line.trim()) {
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const slug = makeSlug(text, usedSlugs);
      html.push(`<h${level} id="${slug}">${applyInline(text)}</h${level}>`);
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      flushList();
      html.push("<hr />");
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)/);
    if (quoteMatch) {
      flushList();
      html.push(`<blockquote>${applyInline(quoteMatch[1])}</blockquote>`);
      continue;
    }

    const ulMatch = line.match(/^[-*]\s+(.*)/);
    if (ulMatch) {
      if (listType && listType !== "ul") flushList();
      if (!listType) listType = "ul";
      listBuffer.push(`<li>${applyInline(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (olMatch) {
      if (listType && listType !== "ol") flushList();
      if (!listType) listType = "ol";
      listBuffer.push(`<li>${applyInline(olMatch[2])}</li>`);
      continue;
    }

    flushList();
    html.push(`<p>${applyInline(line)}</p>`);
  }

  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  flushList();
  return html.join("\n");
}

function toTitle(file) {
  const name = file.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
  return name
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function makeSlug(text, usedSlugs) {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
  if (!usedSlugs[base]) {
    usedSlugs[base] = 1;
    return base;
  }
  const slug = `${base}-${usedSlugs[base]}`;
  usedSlugs[base] += 1;
  return slug;
}
