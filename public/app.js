const state = {
  episodes: [],
  sort: "newest",
  query: "",
  maxVotes: 3,
  remainingVotes: 3,
  votedEpisodeIds: new Set(),
  pendingVotes: new Set()
};

const storagePrefix = "xxt-v1";

const wall = document.querySelector("#wall");
const template = document.querySelector("#episodeCardTemplate");
const searchInput = document.querySelector("#searchInput");
const sortButtons = [...document.querySelectorAll("[data-sort]")];
const totalVotes = document.querySelector("#totalVotes");
const voteAllowance = document.querySelector("#voteAllowance");
const episodeCount = document.querySelector("#episodeCount");
const leaderboard = document.querySelector("#leaderboard");
const toast = document.querySelector("#toast");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const messageSubmit = document.querySelector("#messageSubmit");

function getAnonymousId() {
  const existing = localStorage.getItem(`${storagePrefix}-voter-id`);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(`${storagePrefix}-voter-id`, id);
  return id;
}

function hasLocalVote(episodeId) {
  return state.votedEpisodeIds.has(episodeId);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function formatDuration(seconds) {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}小时${minutes}分` : `${minutes}分钟`;
}

function coverSrc(url) {
  return url || "/fallback-cover.svg";
}

function thumbnailCoverSrc(url) {
  return url ? url.replace(/_(?:320|640)x(?:320|640)(\.[a-z]+)$/i, "_80x80$1") : "/fallback-cover.svg";
}

function filterAndSortEpisodes() {
  const query = state.query.trim().toLowerCase();
  let episodes = state.episodes;

  if (query) {
    episodes = episodes.filter(episode => {
      const text = `${episode.title} ${episode.episodeNo} ${episode.summary || ""}`.toLowerCase();
      return text.includes(query);
    });
  }

  return [...episodes].sort((a, b) => {
    if (state.sort === "votes") return b.votes - a.votes || b.episodeNo - a.episodeNo;
    if (state.sort === "oldest") return a.episodeNo - b.episodeNo;
    return b.episodeNo - a.episodeNo;
  });
}

function renderLeaderboard() {
  const leaders = [...state.episodes]
    .sort((a, b) => b.votes - a.votes || b.episodeNo - a.episodeNo)
    .slice(0, 8);

  leaderboard.replaceChildren(...leaders.map((episode, index) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <span class="rank">${index + 1}</span>
      <span class="title" title="${episode.title}">${episode.title}</span>
      <span class="votes">${episode.votes}票</span>
    `;
    return item;
  }));
}

function renderStats() {
  const count = state.episodes.length;
  const votes = state.episodes.reduce((sum, episode) => sum + episode.votes, 0);
  totalVotes.textContent = votes;
  voteAllowance.textContent = `你还剩 ${state.remainingVotes} / ${state.maxVotes} 票`;
  episodeCount.textContent = `${count} 期节目`;
  renderLeaderboard();
}

function renderWall() {
  const episodes = filterAndSortEpisodes();
  wall.replaceChildren(...episodes.map(episode => {
    const node = template.content.firstElementChild.cloneNode(true);
    const button = node.querySelector(".cover-button");
    const image = node.querySelector("img");
    const badge = node.querySelector(".vote-badge");
    const episodeNo = node.querySelector(".episode-no");
    const title = node.querySelector("h2");
    const voteCount = node.querySelector(".vote-count");
    const summary = node.querySelector(".summary");
    const listenLink = node.querySelector(".listen-link");
    const voted = hasLocalVote(episode.id);

    node.dataset.episodeId = episode.id;
    node.classList.toggle("voted", voted);
    image.src = coverSrc(episode.coverUrl);
    image.alt = episode.title;
    image.addEventListener("error", () => {
      if (image.dataset.fallbackApplied === "true") {
        image.src = "/fallback-cover.svg";
        return;
      }
      image.dataset.fallbackApplied = "true";
      image.src = thumbnailCoverSrc(episode.coverUrl);
    });
    badge.textContent = voted ? "已投" : "投票";
    episodeNo.textContent = `vol.${episode.episodeNo}${episode.duration ? ` · ${formatDuration(episode.duration)}` : ""}`;
    title.textContent = episode.title.replace(/^vol\.\d+\s*/i, "");
    voteCount.textContent = `${episode.votes}票`;
    summary.textContent = episode.summary || "本期 shownote 暂缺，欢迎直接靠封面投缘。";
    listenLink.href = episode.podcastUrl || "#";
    listenLink.hidden = !episode.podcastUrl;

    button.addEventListener("click", () => vote(episode.id));
    return node;
  }));
}

async function vote(episodeId) {
  if (state.pendingVotes.has(episodeId)) return;

  if (hasLocalVote(episodeId)) {
    showToast("这期已经投过啦，三票请雨露均沾。");
    return;
  }

  if (state.remainingVotes <= 0) {
    showToast("三票已经投完啦，感谢把爱用满。");
    return;
  }

  state.pendingVotes.add(episodeId);

  try {
    const response = await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodeId,
        anonymousId: getAnonymousId()
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "投票失败");

    state.remainingVotes = result.remainingVotes;
    state.maxVotes = result.maxVotes;
    state.votedEpisodeIds.add(episodeId);
    const episode = state.episodes.find(item => item.id === episodeId);
    if (episode) episode.votes = result.votes;

    renderStats();
    renderWall();
    showToast(result.duplicate ? "服务端记录显示这期已投过。" : `投上了，还剩 ${state.remainingVotes} 票。`);
  } catch (error) {
    showToast(error.message || "投票失败，请稍后再试。");
  } finally {
    state.pendingVotes.delete(episodeId);
  }
}

async function loadEpisodes() {
  const anonymousId = getAnonymousId();
  const [episodesResponse, statusResponse] = await Promise.all([
    fetch("/api/episodes"),
    fetch(`/api/vote-status?anonymousId=${encodeURIComponent(anonymousId)}`)
  ]);
  const data = await episodesResponse.json();
  const voteStatus = await statusResponse.json();
  state.episodes = data.episodes || [];
  state.maxVotes = voteStatus.maxVotes || 3;
  state.remainingVotes = voteStatus.remainingVotes ?? state.maxVotes;
  state.votedEpisodeIds = new Set(voteStatus.votedEpisodeIds || []);
  renderStats();
  renderWall();
}

async function submitMessage(event) {
  event.preventDefault();
  const message = messageInput.value.trim();

  if (!message) {
    showToast("先写两句，再送出去。");
    messageInput.focus();
    return;
  }

  messageSubmit.disabled = true;

  try {
    const response = await fetch("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "留言失败");

    messageForm.reset();
    showToast("收到了，七周年后台小本本记上。");
  } catch (error) {
    showToast(error.message || "留言失败，请稍后再试。");
  } finally {
    messageSubmit.disabled = false;
  }
}

searchInput.addEventListener("input", event => {
  state.query = event.target.value;
  renderWall();
});

sortButtons.forEach(button => {
  button.addEventListener("click", () => {
    state.sort = button.dataset.sort;
    sortButtons.forEach(item => item.classList.toggle("active", item === button));
    renderWall();
  });
});

messageForm.addEventListener("submit", submitMessage);

loadEpisodes().catch(error => {
  wall.textContent = `加载失败：${error.message}`;
});
