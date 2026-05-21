const loginForm = document.querySelector("#adminLogin");
const tokenInput = document.querySelector("#adminToken");
const dashboard = document.querySelector("#adminDashboard");
const totalVotes = document.querySelector("#adminTotalVotes");
const voterCount = document.querySelector("#adminVoterCount");
const messageCount = document.querySelector("#adminMessageCount");
const voteRows = document.querySelector("#adminVoteRows");
const messages = document.querySelector("#adminMessages");
const toast = document.querySelector("#toast");
let currentToken = new URLSearchParams(location.search).get("token") || "";

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function exportUrl(format = "json") {
  const params = new URLSearchParams({ token: currentToken });
  if (format !== "json") params.set("format", format);
  return `/api/admin/export?${params}`;
}

function render(data) {
  totalVotes.textContent = data.totalVotes;
  voterCount.textContent = data.voterCount;
  messageCount.textContent = data.messages.length;

  voteRows.replaceChildren(...data.voteRows.map(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>vol.${row.episodeNo}</td>
      <td>${row.title}</td>
      <td>${row.votes}</td>
    `;
    return tr;
  }));

  messages.replaceChildren(...data.messages.map(item => {
    const article = document.createElement("article");
    const time = new Date(item.createdAt).toLocaleString("zh-CN");
    article.innerHTML = `
      <time>${time}</time>
      <p></p>
    `;
    article.querySelector("p").textContent = item.message;
    return article;
  }));

  if (!data.messages.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "暂无留言。";
    messages.append(empty);
  }
}

async function loadAdminData() {
  const response = await fetch(exportUrl());
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "后台口令不正确");
  dashboard.hidden = false;
  render(data);
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  currentToken = tokenInput.value.trim();
  if (!currentToken) {
    showToast("请输入后台口令。");
    return;
  }
  try {
    await loadAdminData();
    history.replaceState(null, "", `/admin?token=${encodeURIComponent(currentToken)}`);
    showToast("后台数据已加载。");
  } catch (error) {
    dashboard.hidden = true;
    showToast(error.message);
  }
});

document.querySelectorAll("[data-download]").forEach(button => {
  button.addEventListener("click", () => {
    const format = button.dataset.download;
    location.href = exportUrl(format);
  });
});

if (currentToken) {
  tokenInput.value = currentToken;
  loadAdminData().catch(error => showToast(error.message));
}
