(function () {
  'use strict';

  var DATA = window.RADAR;
  var root = document.getElementById('board');
  if (!DATA || !root) return;

  var SORTS = ['rank', 'name', 'tvl', 'growth', 'age', 'implied'];
  var state = { q: '', category: 'all', status: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtAgeLong(days) {
    if (days === null || days === undefined) return 'unknown';
    return Math.max(0, Math.round(days)) + ' days' + (days >= 365 ? ' (' + (days / 365).toFixed(1) + ' years)' : '');
  }
  function fmtMult(n) {
    return (n === null || n === undefined || !isFinite(n)) ? '—' : n.toFixed(4);
  }
  function fmtFactor(n) {
    return (n === null || n === undefined || !isFinite(n)) ? '—' : n.toFixed(2);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'style') node.setAttribute('style', v);
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c !== null && c !== undefined) node.appendChild(c); });
      } else if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  // ---------------------------------------------------------------- URL state

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var params = new URLSearchParams(raw);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    var status = params.get('status');
    if (status === 'all' || status === 'pre-token' || status === 'live-token') state.status = status;
    var sort = params.get('sort');
    if (sort && SORTS.indexOf(sort) >= 0) state.sort = sort;
    var dir = params.get('dir');
    if (dir === 'asc') state.dir = 1;
    if (dir === 'desc') state.dir = -1;
    if (params.get('p')) state.selected = params.get('p');
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.status !== 'pre-token') params.set('status', state.status);
    if (state.sort !== 'implied' || state.dir !== -1) {
      params.set('sort', state.sort);
      params.set('dir', state.dir < 0 ? 'desc' : 'asc');
    }
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    var base = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', next ? '#' + next : base);
  }

  // ---------------------------------------------------------------- filtering

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { seen[r.category || 'Other'] = true; });
    return Object.keys(seen).sort();
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.status !== 'all' && r.token_status !== state.status) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function compareRows(a, b) {
    var key = state.sort;
    var av, bv;
    if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
    else if (key === 'growth') { av = a.change_7d; bv = b.change_7d; }
    else if (key === 'age') { av = a.age_days; bv = b.age_days; }
    else if (key === 'rank') { av = a.rank; bv = b.rank; }
    else { av = a.implied_value_usd; bv = b.implied_value_usd; }

    if (av === null || av === undefined) {
      if (bv === null || bv === undefined) return a.rank - b.rank;
      return 1;
    }
    if (bv === null || bv === undefined) return -1;
    if (av < bv) return -state.dir;
    if (av > bv) return state.dir;
    return a.rank - b.rank;
  }

  function sortedRows(list) {
    return list.slice().sort(compareRows);
  }

  // ---------------------------------------------------------------- header

  function header() {
    return el('header', { class: 'masthead' },
      el('div', { class: 'brand' },
        el('span', { class: 'brand-mark' }),
        el('div', { class: 'brand-text' },
          el('span', { class: 'brand-name', text: 'Token Radar' }),
          el('span', { class: 'brand-sub', text: 'pre-token launch radar' })
        )
      ),
      el('div', { class: 'snapshot' },
        el('span', { class: 'pill', text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { class: 'model-tag', text: DATA.model_version + ' model' })
      )
    );
  }

  function stat(label, value) {
    return el('div', { class: 'stat' },
      el('span', { text: label }),
      el('b', { text: value })
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('div', { class: 'hero-copy' },
        el('p', { class: 'eyebrow', text: DATA.watchlist_size + ' watchlist protocols · ranked by implied value' }),
        el('h1', { text: 'The protocols a token has not met yet.' }),
        el('p', { class: 'lede', text: 'Every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record, ranked by a model built only from its own TVL, seven-day growth and time since listing. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor; ' + DATA.live_token_size + ' already-issued protocols ride along as comparison rows.' })
      ),
      el('div', { class: 'stats' },
        stat('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
        stat('Pre-token rows', String(DATA.pre_token_size)),
        stat('Early below floor', String(DATA.early_size)),
        stat('Live comparisons', String(DATA.live_token_size))
      )
    );
  }

  // ---------------------------------------------------------------- controls

  function setStatus(value) {
    state.status = value;
    writeHash();
    render();
  }

  function resetAll() {
    state.q = '';
    state.category = 'all';
    state.status = 'pre-token';
    state.sort = 'implied';
    state.dir = -1;
    state.selected = null;
    if (dialog.open) dialog.close();
    writeHash();
    render();
  }

  function controls() {
    var search = el('input', {
      type: 'search',
      id: 'q',
      value: state.q,
      placeholder: 'Search name, slug, category or chain',
      'aria-label': 'Search protocols'
    });
    search.addEventListener('input', function () {
      state.q = search.value;
      writeHash();
      render();
      var next = document.getElementById('q');
      if (next) {
        next.focus();
        if (next.setSelectionRange) next.setSelectionRange(next.value.length, next.value.length);
      }
    });

    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories().map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
      })
    );
    select.addEventListener('change', function () {
      state.category = select.value;
      writeHash();
      render();
    });

    function seg(label, value) {
      return el('button', {
        type: 'button',
        class: 'seg-btn',
        'aria-pressed': state.status === value ? 'true' : 'false',
        text: label,
        onclick: function () { setStatus(value); }
      });
    }

    return el('section', { class: 'controls panel' },
      el('div', { class: 'control' },
        el('label', { for: 'q', text: 'Search' }),
        search
      ),
      el('div', { class: 'control' },
        el('label', { for: 'category', text: 'Category' }),
        select
      ),
      el('div', { class: 'control' },
        el('span', { class: 'field-label', text: 'Token status' }),
        el('div', { class: 'segment' },
          seg('Pre-token', 'pre-token'),
          seg('Live token', 'live-token'),
          seg('All', 'all')
        )
      ),
      el('button', { type: 'button', class: 'ghost', text: 'Reset', onclick: resetAll }),
      el('span', { class: 'count', text: filteredRows().length + ' of ' + DATA.rows.length + ' rows' })
    );
  }

  // ---------------------------------------------------------------- table

  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else {
      state.sort = key;
      state.dir = key === 'name' || key === 'rank' ? 1 : -1;
    }
    writeHash();
    render();
  }

  function th(key, label, numeric) {
    var active = state.sort === key;
    return el('th', {
      scope: 'col',
      class: numeric ? 'num' : null,
      'aria-sort': active ? (state.dir < 0 ? 'descending' : 'ascending') : 'none'
    },
      el('button', {
        type: 'button',
        class: 'sort' + (active ? ' active' : ''),
        onclick: function () { setSort(key); }
      },
        label,
        el('span', { class: 'sort-arrow', 'aria-hidden': 'true', text: active ? (state.dir < 0 ? '↓' : '↑') : '↕' })
      )
    );
  }

  function growthCell(value) {
    if (value === null || value === undefined) {
      return el('td', { class: 'num growth neutral', text: '—' });
    }
    var up = value >= 0;
    return el('td', { class: 'num growth ' + (up ? 'pos' : 'neg') },
      el('span', { class: 'arrow', 'aria-hidden': 'true', text: up ? '▲' : '▼' }),
      fmtPct(value)
    );
  }

  function boardRow(r, maxImplied) {
    var isLive = r.token_status === 'live-token';
    var bar = maxImplied > 0 ? Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100)) : 3;
    var chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'unnamed chain';
    var rankClass = 'rank-badge' + (r.rank <= 3 ? ' top' : '');
    return el('tr', {
      class: isLive ? 'live-row' : null,
      tabindex: '0',
      'data-slug': r.slug,
      'data-selected': state.selected === r.slug ? 'true' : 'false',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail(r.slug);
        }
      }
    },
      el('td', { class: 'rank-cell' }, el('span', { class: rankClass, text: String(r.rank) })),
      el('td', null,
        el('span', { class: 'name-main', text: r.name }),
        el('span', { class: 'name-sub', text: (r.category || 'Other') + ' · ' + chains })
      ),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      growthCell(r.change_7d),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', { class: 'num implied-cell' },
        el('div', { class: 'implied-inner' },
          el('span', { class: 'implied-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + bar + '%' })),
          el('span', { class: 'implied-value', text: fmtUsd(r.implied_value_usd) })
        )
      ),
      el('td', null,
        el('span', { class: 'status-pill' + (isLive ? ' live' : ''), text: isLive ? 'already issued' : 'pre-token' })
      )
    );
  }

  function boardPanel() {
    var list = sortedRows(filteredRows());
    var maxImplied = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 0);
    var head = el('div', { class: 'board-head' },
      el('div', null,
        el('h2', { text: 'Ranked board' }),
        el('span', { class: 'board-note', text: state.status === 'pre-token' ? 'Pre-token ranks, strongest model value first.' : state.status === 'live-token' ? 'Already-issued rows, shown as comparisons against the model.' : 'Every board row, pre-token and already-issued together.' })
      ),
      el('span', { class: 'board-note', text: list.length + ' shown · click a row for its model and farm plan' })
    );

    if (list.length === 0) {
      return el('section', { class: 'panel board' }, head,
        el('div', { class: 'empty' },
          el('h2', { text: 'No protocol matches that filter' }),
          el('p', { text: 'Clear the search or pick another category and status to see the board again.' }),
          el('button', { type: 'button', class: 'ghost', text: 'Reset filters', onclick: resetAll })
        )
      );
    }

    var tbody = el('tbody');
    list.forEach(function (r) { tbody.appendChild(boardRow(r, maxImplied)); });

    return el('section', { class: 'panel board' }, head,
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null,
            el('tr', null,
              th('rank', 'Rank', false),
              th('name', 'Protocol', false),
              th('tvl', 'TVL', true),
              th('growth', '7d growth', true),
              th('age', 'Age', true),
              th('implied', 'Implied value', true),
              el('th', { scope: 'col', text: 'Token' })
            )
          ),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var categoryValues = DATA.rows.map(function (r) { return r.category_multiplier; });
    var catMin = Math.min.apply(null, categoryValues);
    var catMax = Math.max.apply(null, categoryValues);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'The value model' }),
      el('p', { text: 'Every row uses one function of its own snapshot figures. Nothing is hand-picked by name: TVL sets a log-compressed multiple, seven-day growth adjusts it mildly, time without a token raises it to a four-year cap, and the category makes a small stated adjustment.' }),
      el('div', { class: 'formula' },
        'baseMultiple = clamp(' + m.base_multiple + ' × (1 + ' + m.tvl_log_weight + ' × log10(' + fmtUsd(m.reference_tvl_usd) + ' / TVL)), ' + m.base_multiple_min + ', ' + m.base_multiple_max + ')\n' +
        'growth       = 1 + ' + m.growth_weight + ' × tanh(clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / ' + m.growth_scale + ')\n' +
        'maturity     = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + '\n' +
        'implied      = round(TVL × baseMultiple × growth × maturity × categoryFactor)'
      ),
      el('div', { class: 'model-grid' },
        el('div', { class: 'model-card' }, el('b', { text: 'TVL compression' }), el('span', { text: 'A log term lowers the multiple on the largest TVL and raises it on smaller protocols, so the head does not own the board.' })),
        el('div', { class: 'model-card' }, el('b', { text: 'Seven-day growth' }), el('span', { text: 'A tanh curve is monotonic and bounded, so a hot week helps without turning one print into a ranking.' })),
        el('div', { class: 'model-card' }, el('b', { text: 'Time without a token' }), el('span', { text: 'The longer a protocol has run with no token, the more its record can support an airdrop, capped at ' + Math.round(m.maturity_days / 365) + ' years.' })),
        el('div', { class: 'model-card' }, el('b', { text: 'Category factor' }), el('span', { text: 'A small adjustment from ' + fmtFactor(catMin) + ' to ' + fmtFactor(catMax) + ', stated on every detail view.' }))
      ),
      el('p', { class: 'footnote', text: 'Missing change_7d is neutral; a missing listing date uses ' + m.unknown_age_days + ' days. Live-token rows use the same arithmetic but are labelled comparisons, never pre-token claims.' })
    );
  }

  // ---------------------------------------------------------------- detail

  function splitStep(text) {
    var costAt = text.indexOf(' Cost: ');
    var timeAt = costAt >= 0 ? text.indexOf(' Time: ', costAt) : -1;
    if (costAt < 0) return { action: text, cost: '', time: '' };
    var action = text.slice(0, costAt);
    var cost = timeAt >= 0 ? text.slice(costAt + 7, timeAt) : text.slice(costAt + 7);
    var time = timeAt >= 0 ? text.slice(timeAt + 7) : '';
    cost = cost.replace(/\.$/, '');
    time = time.replace(/\.$/, '');
    return { action: action, cost: cost, time: time };
  }

  function fact(label, value, mono) {
    return el('div', { class: 'fact' },
      el('span', { text: label }),
      el('b', { class: mono ? 'mono' : null, text: value })
    );
  }

  function decomp(label, value, total) {
    return el('div', { class: 'decomp-row' + (total ? ' total' : '') },
      el('span', { text: label }),
      el('b', { text: value })
    );
  }

  function openDetail(slug, silent) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    if (!silent) writeHash();

    var isLive = row.token_status === 'live-token';
    var chains = row.chains && row.chains.length ? row.chains.join(', ') : 'unnamed chain';
    var baseValue = row.tvl_usd * row.base_multiple;

    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-top' },
      el('span', { class: 'detail-rank', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
      el('button', { type: 'button', class: 'close', text: 'Close', onclick: function () { dialog.close(); } })
    ));

    var body = el('div', { class: 'detail-body' });
    body.appendChild(el('h2', { class: 'detail-title', text: row.name }));
    body.appendChild(el('p', { class: 'detail-sub', text: (row.category || 'Other') + ' · ' + (row.chains && row.chains.length ? row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') : 'chain unknown') }));
    body.appendChild(el('div', { class: 'badges' },
      el('span', { class: 'badge ' + (isLive ? 'live' : 'pre'), text: isLive ? 'already issued' : 'pre-token' }),
      el('span', { class: 'badge', text: row.category || 'Other' }),
      el('span', { class: 'badge', text: DATA.model_version + ' model' })
    ));

    var impliedSection = el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'big-value' },
        el('b', { text: fmtUsd(row.implied_value_usd) }),
        el('span', { text: isLive ? 'model comparison' : 'model estimate' })
      ),
      el('p', { class: 'value-note', text: isLive ? 'This token already trades. The value below is the model applied to its TVL, shown as a comparison against its recorded market cap.' : 'An estimate of what a token could be worth if the protocol record stayed as it is. It is not a price and not a promise that a token will be issued.' })
    );
    var decomposition = el('div', { class: 'decomp' },
      decomp('TVL', fmtUsd(row.tvl_usd)),
      decomp('TVL multiple', '× ' + fmtMult(row.base_multiple)),
      decomp('Base value', fmtUsd(baseValue)),
      decomp('7d growth', fmtPct(row.change_7d) + ' → × ' + fmtMult(row.growth_multiplier)),
      decomp('Age without a token', fmtAgeLong(row.age_days) + ' → × ' + fmtMult(row.maturity_multiplier)),
      decomp('Category factor', (row.category || 'Other') + ' → × ' + fmtFactor(row.category_multiplier)),
      decomp('Implied value', fmtUsd(row.implied_value_usd), true)
    );
    impliedSection.appendChild(decomposition);
    if (isLive && row.mcap_usd !== null) {
      impliedSection.appendChild(el('div', { class: 'decomp' }, decomp('Recorded market cap', fmtUsd(row.mcap_usd), true)));
    }
    body.appendChild(impliedSection);

    var facts = el('div', { class: 'fact-grid' },
      fact('TVL', fmtUsd(row.tvl_usd), true),
      fact('Seven-day change', fmtPct(row.change_7d), true),
      fact('Age', fmtAgeLong(row.age_days)),
      fact('Listed', row.listed_at || 'unknown'),
      fact('Chains', chains),
      fact('Market cap', isLive ? fmtUsd(row.mcap_usd) : 'no token recorded', true),
      fact('Slug', row.slug, true),
      fact('Status', isLive ? 'already issued' : 'pre-token')
    );
    var steps = el('ol', { class: 'steps' });
    row.farm_steps.forEach(function (text, i) {
      var step = splitStep(text);
      steps.appendChild(el('li', { class: 'step' },
        el('span', { class: 'step-num', text: String(i + 1) }),
        el('div', null,
          el('p', { class: 'step-action', text: step.action }),
          el('div', { class: 'step-cost' },
            step.cost ? el('span', { text: 'Cost: ' + step.cost }) : null,
            step.time ? el('span', { text: 'Time: ' + step.time }) : null
          )
        )
      ));
    });
    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: isLive ? 'Comparison plan' : 'Farm plan' }),
      steps,
      el('p', { class: 'detail-note', text: isLive ? 'This row is an already-issued comparison. Its token trades, so there is no pre-token farm position to hold for an airdrop; the steps show how to use it as a benchmark.' : 'Costs and times are approximate. Use a wallet you control, keep a log, and claim only from the protocol\'s own published page.' })
    ));

    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Protocol record' }),
      facts
    ));

    dialog.appendChild(body);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else if (!dialog.open) {
      dialog.setAttribute('open', '');
    }
  }

  // ---------------------------------------------------------------- start

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-label': 'Protocol detail' });
  dialog.addEventListener('close', function () {
    state.selected = null;
    writeHash();
  });
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) dialog.close();
  });
  document.body.appendChild(dialog);

  function render() {
    root.textContent = '';
    root.appendChild(el('div', { class: 'shell' },
      header(),
      hero(),
      controls(),
      boardPanel(),
      modelPanel()
    ));
    root.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected, true);
  }

  readHash();
  render();
})();
