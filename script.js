'use strict';

    const NOME_ALUNO = 'Vinicius Gabriel Flores da Cunha';
    const MATRICULA = '335842';
    const API_BASE = 'https://www.gamerpower.com/api';
    const LOGS_API_BASE = 'https://www.piway.com.br/unoesc/api';
    const INITIAL_VISIBLE = 9;

    const el = {
      grid: document.querySelector('#games-grid'),
      status: document.querySelector('#status-message'),
      count: document.querySelector('#stat-count'),
      worth: document.querySelector('#stat-worth'),
      caption: document.querySelector('#results-caption'),
      search: document.querySelector('#search-input'),
      form: document.querySelector('#filter-form'),
      platform: document.querySelector('#platform-select'),
      type: document.querySelector('#type-select'),
      sort: document.querySelector('#sort-select'),
      refresh: document.querySelector('#refresh-button'),
      empty: document.querySelector('#empty-state'),
      emptyTitle: document.querySelector('#empty-title'),
      emptyDescription: document.querySelector('#empty-description'),
      clear: document.querySelector('#clear-filters'),
      emptyReset: document.querySelector('#empty-reset'),
      more: document.querySelector('#show-more'),
      modal: document.querySelector('#detail-modal'),
      modalContent: document.querySelector('#modal-content'),
      modalTitle: document.querySelector('#modal-title'),
      modalClose: document.querySelector('#modal-close'),
      logsRefresh: document.querySelector('#logs-refresh'),
      logsStatus: document.querySelector('#logs-status'),
      logsList: document.querySelector('#logs-list')
    };

    let allGiveaways = [];
    let shownCount = INITIAL_VISIBLE;
    let currentFilters = { platform: '', type: '', sort: 'date' };
    let latestRequest = 0;
    let latestLogsRequest = 0;
    let logsViewed = false;

    function escapeHTML(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function normalize(value) {
      return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function labelType(type) {
      const v = normalize(type);
      if (v.includes('loot') || v.includes('dlc') || v.includes('item')) return 'Itens / DLC';
      if (v.includes('beta') || v.includes('early access') || v.includes('playtest')) return 'Beta / Playtest';
      if (v.includes('game')) return 'Jogo completo';
      return type || 'Oferta';
    }

    function formatDate(value) {
      if (!value || value === 'N/A') return 'Prazo não informado';
      const date = new Date(String(value).replace(' ', 'T'));
      if (Number.isNaN(date.getTime())) return String(value);
      return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
    }

    function platformList(value) {
      return String(value || '').split(',').map(part => part.trim()).filter(Boolean);
    }

    function matriculaConfigurada() {
      return Boolean(MATRICULA);
    }

    function describeGamerPowerMethod(path) {
      const [resource, query = ''] = path.split('?');
      const params = new URLSearchParams(query);
      if (resource === '/giveaways') {
        const filtros = [];
        if (params.has('platform')) filtros.push(`plataforma ${params.get('platform')}`);
        if (params.has('type')) filtros.push(`tipo ${params.get('type')}`);
        if (params.has('sort-by')) filtros.push(`ordenação ${params.get('sort-by')}`);
        return `GET giveaways${filtros.length ? ` com filtro: ${filtros.join(', ')}` : ' sem filtros'}`;
      }
      if (resource === '/giveaway') return `GET detalhes da oferta ID ${params.get('id') || 'não informado'}`;
      if (resource === '/worth') {
        const filtros = [];
        if (params.has('platform')) filtros.push(`plataforma ${params.get('platform')}`);
        if (params.has('type')) filtros.push(`tipo ${params.get('type')}`);
        return `GET valor estimado${filtros.length ? ` com filtro: ${filtros.join(', ')}` : ' sem filtros'}`;
      }
      return `GET ${resource.replace(/^\//, '')}`;
    }

    function summarizeApiResult(path, data) {
      if (path.startsWith('/giveaways')) {
        if (Array.isArray(data)) return `${data.length} ofertas recebidas`;
        return data && Number(data.status) === 201 ? 'Nenhuma oferta encontrada' : 'Consulta de ofertas concluída';
      }
      if (path.startsWith('/giveaway')) {
        const item = Array.isArray(data) ? data[0] : data;
        const title = item && item.title ? String(item.title).replace(/[\/]/g, '-').slice(0, 95) : 'detalhes recebidos';
        return `Detalhes consultados: ${title}`;
      }
      if (path.startsWith('/worth')) {
        const value = findValueByKeys(data, ['estimated_worth', 'total_worth', 'totalworth', 'worth', 'total_value', 'value']);
        return value !== null ? `Valor estimado consultado: ${String(value).slice(0, 80)}` : 'Consulta do valor estimado concluída';
      }
      return 'Requisição concluída';
    }

    async function requestJSON(path) {
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error(`A API respondeu com status HTTP ${response.status}.`);
      const data = await response.json();

      await registrarLog(describeGamerPowerMethod(path), summarizeApiResult(path, data));
      return data;
    }

    function setLogsStatus(message, state = '') {
      el.logsStatus.className = `logs-status${state ? ` ${state}` : ''}`;
      el.logsStatus.textContent = message;
    }

    function respostaIndicaErro(payload, rawText = '') {
      const texto = normalize(`${rawText} ${typeof payload === 'string' ? payload : JSON.stringify(payload || '')}`);
      if (texto.includes('matricula do aluno e invalida')) return true;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        for (const [chave, valor] of Object.entries(payload)) {
          const nome = normalize(chave);
          if ((nome === 'erro' || nome === 'error') && valor && String(valor).trim()) return true;
        }
      }
      return /^\s*(erro|error)\b/.test(texto);
    }

    function mensagemDaResposta(payload, textoBruto = '') {
      if (typeof payload === 'string' && payload.trim()) return payload.trim();
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const mensagem = valorDoCampo(payload, ['sucesso', 'mensagem', 'message', 'erro', 'error']);
        if (mensagem !== undefined && mensagem !== null && String(mensagem).trim()) return String(mensagem);
      }
      return String(textoBruto || '').trim();
    }

    async function registrarLog(metodo, resultado) {
      if (!matriculaConfigurada()) {
        setLogsStatus('Configure sua matrícula na constante MATRICULA no início de script.js para habilitar o registro de logs.', 'warning');
        return;
      }

      const partes = [MATRICULA.trim(), 'GamerPower', metodo, resultado].map(parte => encodeURIComponent(String(parte).slice(0, 180)));
      const url = `${LOGS_API_BASE}/inserir/log/${partes.join('/')}`;
      try {
        const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json, text/plain, */*' } });
        const texto = await response.text();
        let payload = texto;
        try { payload = JSON.parse(texto); } catch (_) { /* A API também pode retornar texto simples. */ }
        if (!response.ok || respostaIndicaErro(payload, texto)) {
          throw new Error(texto || `HTTP ${response.status}`);
        }
        setLogsStatus('Requisição à GamerPower registrada na API de logs.', 'success');
        if (logsViewed) await carregarLogs(true);
      } catch (error) {
        console.warn('Não foi possível registrar o log:', error);
        setLogsStatus('Não foi possível registrar o log. Confira a matrícula e a conexão com a API de logs.', 'error');
      }
    }

    function valorDoCampo(objeto, nomes) {
      if (!objeto || typeof objeto !== 'object') return undefined;
      const normalizarChave = texto => String(texto).toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const nome of nomes) {
        const desejado = normalizarChave(nome);
        const entrada = Object.entries(objeto).find(([chave]) => normalizarChave(chave) === desejado);
        if (entrada) return entrada[1];
      }
      return undefined;
    }

    function extrairListaDeLogs(payload) {
      if (Array.isArray(payload)) return payload;
      if (!payload || typeof payload !== 'object') return null;
      for (const chave of ['logs', 'data', 'resultado', 'sucesso', 'SUCESSO']) {
        if (Array.isArray(payload[chave])) return payload[chave];
      }
      return null;
    }

    function formatarDataLog(valor) {
      if (!valor) return 'Data não informada';
      const data = new Date(valor);
      if (Number.isNaN(data.getTime())) return String(valor);
      return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(data);
    }

    function renderLogs(logs) {
      if (!logs.length) {
        el.logsList.innerHTML = '<div class="logs-empty">Nenhum log foi registrado para esta matrícula.</div>';
        return;
      }
      el.logsList.innerHTML = logs.map((log, indice) => {
        const id = valorDoCampo(log, ['idlog', 'id_log', 'idLog', 'id']);
        const api = valorDoCampo(log, ['api', 'nomeapi']) ?? 'API não informada';
        const metodo = valorDoCampo(log, ['metodo', 'method', 'nomeMetodo', 'operacao']) ?? 'Método não informado';
        const resultado = valorDoCampo(log, ['resultado', 'result', 'resposta', 'response']) ?? 'Resultado não informado';
        const data = valorDoCampo(log, ['data', 'datahora', 'created_at', 'createdAt', 'dataregistro', 'timestamp']);
        const idTexto = id !== undefined && id !== null && id !== '' ? String(id) : '';
        return `<article class="log-card">
          <div class="log-main">
            <h3 class="log-title">${escapeHTML(api)} <span class="log-id">${idTexto ? `Log #${escapeHTML(idTexto)}` : `Registro ${indice + 1}`}</span></h3>
            <div class="log-details">
              <div><strong>Método:</strong> ${escapeHTML(metodo)}</div>
              <div><strong>Resultado:</strong> ${escapeHTML(resultado)}</div>
              <div><strong>Data:</strong> ${escapeHTML(formatarDataLog(data))}</div>
            </div>
          </div>
          ${idTexto ? `<button class="log-delete" type="button" data-log-id="${escapeHTML(idTexto)}">Excluir log</button>` : '<span class="log-id">ID de exclusão não fornecido</span>'}
        </article>`;
      }).join('');
    }

    async function carregarLogs(silencioso = false) {
      logsViewed = true;
      if (!matriculaConfigurada()) {
        setLogsStatus('Configure sua matrícula na constante MATRICULA no início de script.js antes de consultar os logs.', 'warning');
        el.logsList.innerHTML = '<div class="logs-empty">A consulta de logs será habilitada depois de informar a matrícula.</div>';
        return;
      }

      const requestId = ++latestLogsRequest;
      if (!silencioso) setLogsStatus('Consultando os logs registrados...');
      el.logsRefresh.disabled = true;
      try {
        const response = await fetch(`${LOGS_API_BASE}/logs/${encodeURIComponent(MATRICULA.trim())}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json, text/plain, */*' }
        });
        const texto = await response.text();
        let payload = texto;
        try { payload = JSON.parse(texto); } catch (_) { /* Mantém o retorno em texto para exibir erro. */ }
        if (!response.ok || respostaIndicaErro(payload, texto)) throw new Error(texto || `HTTP ${response.status}`);
        const logs = extrairListaDeLogs(payload);
        if (!logs) throw new Error('A resposta da API não contém uma lista de logs reconhecida.');
        if (requestId !== latestLogsRequest) return;
        renderLogs(logs);
        setLogsStatus(`${logs.length} ${logs.length === 1 ? 'log encontrado' : 'logs encontrados'}.`, 'success');
      } catch (error) {
        if (requestId !== latestLogsRequest) return;
        console.warn('Falha ao consultar logs:', error);
        setLogsStatus('Não foi possível consultar os logs. Verifique a matrícula e tente novamente.', 'error');
        el.logsList.innerHTML = `<div class="logs-empty">${escapeHTML(error.message || 'Erro ao consultar logs.')}</div>`;
      } finally {
        if (requestId === latestLogsRequest) el.logsRefresh.disabled = false;
      }
    }

    async function excluirLog(idLog, botao) {
      if (!matriculaConfigurada()) {
        setLogsStatus('Configure sua matrícula na constante MATRICULA no início de script.js.', 'warning');
        return;
      }
      if (!window.confirm(`Deseja realmente excluir o log #${idLog}?`)) return;
      if (botao) {
        botao.disabled = true;
        botao.textContent = 'Excluindo...';
      }
      try {
        const url = `${LOGS_API_BASE}/excluir/log/${encodeURIComponent(idLog)}/aluno/${encodeURIComponent(MATRICULA)}`;
        console.log(url);
        const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json, text/plain, */*' } });
        const texto = await response.text();
        let payload = texto;
        try { payload = JSON.parse(texto); } catch (_) { /* Resposta em texto simples. */ }
        if (!response.ok) throw new Error(texto || `HTTP ${response.status}`);
        const mensagem = mensagemDaResposta(payload, texto);
        if (normalize(mensagem).includes('nenhum log foi excluido')) {
          setLogsStatus(`A API informou: ${mensagem}`, 'warning');
        } else {
          setLogsStatus(mensagem || `Solicitação de exclusão do log #${idLog} enviada.`, 'success');
        }
        await carregarLogs(true);
      } catch (error) {
        console.warn('Falha ao excluir log:', error);
        setLogsStatus('Não foi possível excluir este log. Confira a matrícula e tente novamente.', 'error');
      } finally {
        if (botao) {
          botao.disabled = false;
          botao.textContent = 'Excluir log';
        }
      }
    }

    function setStatus(message, state = 'loading') {
      el.status.className = `status${state === 'error' ? ' error' : state === 'success' ? ' success' : ''}`;
      const icon = state === 'loading' ? '<span class="spinner" aria-hidden="true"></span>' : '';
      el.status.innerHTML = `${icon}<span>${escapeHTML(message)}</span>`;
      if (state === 'success') el.status.classList.add('hidden');
      else el.status.classList.remove('hidden');
    }

    function findValueByKeys(object, desiredKeys) {
      if (!object || typeof object !== 'object') return null;
      for (const [key, value] of Object.entries(object)) {
        if (desiredKeys.includes(key.toLowerCase()) && (typeof value === 'string' || typeof value === 'number')) return value;
      }
      for (const value of Object.values(object)) {
        if (value && typeof value === 'object') {
          const found = findValueByKeys(value, desiredKeys);
          if (found !== null) return found;
        }
      }
      return null;
    }

    async function loadWorth() {
      const params = new URLSearchParams();
      if (currentFilters.platform) params.set('platform', currentFilters.platform);
      if (currentFilters.type) params.set('type', currentFilters.type);
      const query = params.toString();
      try {
        const data = await requestJSON(`/worth${query ? `?${query}` : ''}`);
        const worth = findValueByKeys(data, ['estimated_worth', 'total_worth', 'totalworth', 'worth', 'total_value', 'value']);
        const count = findValueByKeys(data, ['total_giveaways', 'active_giveaways', 'totalgiveaways', 'count', 'total']);
        if (worth !== null) el.worth.textContent = String(worth).startsWith('$') ? worth : `$${worth}`;
        else if (count !== null) el.worth.textContent = `${count} ofertas ativas`;
        else el.worth.textContent = 'Dados consultados';
        el.worth.title = JSON.stringify(data);
      } catch (error) {
        el.worth.textContent = 'Indisponível';
        el.worth.title = 'Não foi possível consultar o endpoint /worth. As ofertas ainda podem ser carregadas normalmente.';
        console.warn('Falha no endpoint /worth:', error);
      }
    }

    function buildGiveawaysPath(filters) {
      const params = new URLSearchParams();
      if (filters.platform) params.set('platform', filters.platform);
      if (filters.type) params.set('type', filters.type);
      if (filters.sort && filters.sort !== 'date') params.set('sort-by', filters.sort);
      const query = params.toString();
      return `/giveaways${query ? `?${query}` : ''}`;
    }

    async function loadGiveaways(filters = currentFilters) {
      const requestId = ++latestRequest;
      currentFilters = { ...filters };
      shownCount = INITIAL_VISIBLE;
      el.grid.innerHTML = '';
      el.empty.classList.add('hidden');
      el.more.classList.add('hidden');
      el.count.textContent = '…';
      el.caption.textContent = 'Buscando ofertas atualizadas...';
      setStatus('Consultando os dados da GamerPower API...');
      loadWorth();

      try {
        const data = await requestJSON(buildGiveawaysPath(currentFilters));
        if (requestId !== latestRequest) return;
        if (Array.isArray(data)) allGiveaways = data;
        else if (data && Number(data.status) === 201) allGiveaways = [];
        else throw new Error('A API retornou um formato de dados inesperado.');

        el.count.textContent = String(allGiveaways.length);
        const current = applyLocalSearch(allGiveaways);
        el.caption.textContent = `${current.length} ${current.length === 1 ? 'oferta encontrada' : 'ofertas encontradas'}${hasActiveFilters() ? ' com os filtros selecionados' : ''}.`;
        setStatus('Ofertas carregadas.', 'success');
        renderCards(current);
      } catch (error) {
        if (requestId !== latestRequest) return;
        allGiveaways = [];
        el.count.textContent = '—';
        el.caption.textContent = 'Não foi possível carregar os dados.';
        setStatus(`${error.message} Confira sua conexão ou tente novamente pelo Live Server.`, 'error');
        el.grid.innerHTML = '';
        el.empty.classList.remove('hidden');
        el.emptyTitle.textContent = 'Não foi possível conectar à API';
        el.emptyDescription.textContent = 'A API pode estar temporariamente indisponível ou o navegador pode ter bloqueado a requisição. Clique em “Atualizar ofertas” para tentar novamente.';
        el.more.classList.add('hidden');
      }
    }

    function hasActiveFilters() {
      return Boolean(currentFilters.platform || currentFilters.type || currentFilters.sort !== 'date');
    }

    function applyLocalSearch(items) {
      const query = normalize(el.search.value.trim());
      if (!query) return items;
      return items.filter(item => normalize(`${item.title || ''} ${item.description || ''} ${item.platforms || ''}`).includes(query));
    }

    function renderCards(items) {
      el.grid.innerHTML = '';
      if (!items.length) {
        el.empty.classList.remove('hidden');
        el.emptyTitle.textContent = 'Nenhuma oferta encontrada';
        el.emptyDescription.textContent = 'Tente pesquisar outro termo ou selecione filtros diferentes.';
        el.more.classList.add('hidden');
        return;
      }
      el.empty.classList.add('hidden');
      const visible = items.slice(0, shownCount);
      el.grid.innerHTML = visible.map(item => {
        const title = escapeHTML(item.title || 'Oferta sem título');
        const description = escapeHTML(item.description || 'Abra os detalhes para saber mais sobre esta oferta.');
        const image = /^https:\/\//i.test(item.thumbnail || '') ? escapeHTML(item.thumbnail) : '';
        const platforms = platformList(item.platforms).slice(0, 3).map(p => `<span class="platform-pill">${escapeHTML(p)}</span>`).join('');
        const worth = item.worth && item.worth !== 'N/A' ? escapeHTML(item.worth) : 'GRÁTIS';
        const type = escapeHTML(labelType(item.type));
        const endDate = item.end_date && item.end_date !== 'N/A' ? `Até ${escapeHTML(formatDate(item.end_date))}` : 'Prazo variável';
        const users = Number(item.users);
        const popularity = Number.isFinite(users) && users > 0 ? `${users.toLocaleString('pt-BR')} interessados` : 'Oferta ativa';
        const id = Number(item.id);
        return `<article class="game-card">
          <div class="image-wrap">
            ${image ? `<img class="game-image" src="${image}" alt="Imagem de ${title}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.classList.remove('hidden')">` : ''}
            <div class="image-placeholder ${image ? 'hidden' : ''}" aria-hidden="true">✦</div>
            <span class="type-pill">${type}</span><span class="worth-pill">${worth}</span>
          </div>
          <div class="card-content">
            <div class="platforms">${platforms || '<span class="platform-pill">Plataforma não informada</span>'}</div>
            <h3 class="card-title">${title}</h3>
            <p class="card-description">${description}</p>
            <div class="card-meta"><span>◷ ${endDate}</span><span>${escapeHTML(popularity)}</span></div>
            <div class="card-actions"><button class="btn btn-secondary detail-button" type="button" data-id="${Number.isFinite(id) ? id : ''}">Ver detalhes</button><a class="btn btn-primary" href="${safeLink(item.open_giveaway_url || item.open_giveaway || item.gamerpower_url)}" target="_blank" rel="noopener noreferrer">Ver oferta ↗</a></div>
          </div>
        </article>`;
      }).join('');

      el.more.classList.toggle('hidden', items.length <= shownCount);
      el.grid.querySelectorAll('.detail-button').forEach(button => button.addEventListener('click', () => openDetails(button.dataset.id)));
    }

    function safeLink(url) {
      try {
        const parsed = new URL(String(url || ''));
        if (parsed.protocol === 'https:') return escapeHTML(parsed.href);
      } catch (_) { /* URL ausente ou inválida */ }
      return 'https://www.gamerpower.com/';
    }

    // Método 3: GET /giveaway?id={id}, para mostrar dados sem repetição de uma oferta.
    async function openDetails(id) {
      if (!id) return;
      el.modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
      el.modalTitle.textContent = 'Carregando detalhes...';
      el.modalContent.innerHTML = '<div class="status"><span class="spinner" aria-hidden="true"></span><span>Consultando a oferta na API...</span></div>';
      try {
        const data = await requestJSON(`/giveaway?id=${encodeURIComponent(id)}`);
        const item = Array.isArray(data) ? data[0] : data;
        if (!item || typeof item !== 'object' || item.status === 404) throw new Error('A API não encontrou os detalhes desta oferta.');
        const title = item.title || 'Detalhes da oferta';
        const image = /^https:\/\//i.test(item.image || item.thumbnail || '') ? safeLink(item.image || item.thumbnail) : '';
        const description = escapeHTML(item.description || 'Descrição não disponível.');
        const instructions = String(item.instructions || '').split(/\r?\n/).map(line => line.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
        const link = safeLink(item.open_giveaway_url || item.open_giveaway || item.gamerpower_url);
        const mainUrl = safeLink(item.gamerpower_url);
        el.modalTitle.textContent = title;
        el.modalContent.innerHTML = `${image ? `<img class="modal-image" src="${image}" alt="Imagem de ${escapeHTML(title)}">` : ''}
          <div class="platforms" style="margin-top:14px">${platformList(item.platforms).map(p => `<span class="platform-pill">${escapeHTML(p)}</span>`).join('')}</div>
          <div class="detail-label">Sobre a oferta</div><p>${description}</p>
          <div class="detail-label">Como resgatar</div>${instructions.length ? `<ol class="instructions">${instructions.map(step => `<li>${escapeHTML(step)}</li>`).join('')}</ol>` : '<p>Consulte a página da oferta para ver as instruções de resgate.</p>'}
          <div class="api-debug">Dados carregados individualmente pelo endpoint <strong>GET /giveaway?id=${escapeHTML(id)}</strong>.</div>
          <div class="modal-footer"><a class="btn btn-primary" href="${link}" target="_blank" rel="noopener noreferrer">Acessar oferta ↗</a><a class="btn btn-secondary" href="${mainUrl}" target="_blank" rel="noopener noreferrer">Página GamerPower</a></div>`;
      } catch (error) {
        el.modalTitle.textContent = 'Detalhes indisponíveis';
        el.modalContent.innerHTML = `<p>${escapeHTML(error.message || 'Não foi possível carregar os detalhes.')}</p><p>Feche esta janela e tente novamente em alguns instantes.</p>`;
      }
    }

    function closeModal() {
      el.modal.classList.add('hidden');
      document.body.style.overflow = '';
    }

    el.form.addEventListener('submit', event => {
      event.preventDefault();
      loadGiveaways({ platform: el.platform.value, type: el.type.value, sort: el.sort.value });
    });

    el.clear.addEventListener('click', resetFilters);
    el.emptyReset.addEventListener('click', resetFilters);
    el.refresh.addEventListener('click', () => loadGiveaways());

    function resetFilters() {
      el.search.value = '';
      el.platform.value = '';
      el.type.value = '';
      el.sort.value = 'date';
      loadGiveaways({ platform: '', type: '', sort: 'date' });
    }

    el.search.addEventListener('input', () => {
      const filtered = applyLocalSearch(allGiveaways);
      el.caption.textContent = `${filtered.length} ${filtered.length === 1 ? 'oferta encontrada' : 'ofertas encontradas'}${el.search.value.trim() ? ' para sua pesquisa' : ''}.`;
      renderCards(filtered);
    });

    el.more.addEventListener('click', () => {
      shownCount += INITIAL_VISIBLE;
      renderCards(applyLocalSearch(allGiveaways));
    });
    el.modalClose.addEventListener('click', closeModal);
    el.modal.addEventListener('click', event => { if (event.target === el.modal) closeModal(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });

    el.logsRefresh.addEventListener('click', () => carregarLogs(false));
    el.logsList.addEventListener('click', event => {
      const botao = event.target.closest('.log-delete');
      if (botao) excluirLog(botao.dataset.logId, botao);
    });

    document.querySelector('#student-name').textContent = NOME_ALUNO;
    loadGiveaways({ ...currentFilters });
