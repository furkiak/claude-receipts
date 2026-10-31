'use strict';
// What Claude *said*: success claims in the final message (English + Turkish).

const { short } = require('./commands');

const CHECK = '(?:✅|✓|✔|☑)';
// "✅ tests" counts as a claim — except in Markdown table rows, which are usually plans or status boards.
const NEAR = new Set();
const near = (kw) => { const re = new RegExp(`(?:${kw})[^.\\n]{0,30}${CHECK}|${CHECK}[^.\\n]{0,30}(?:${kw})`, 'iu'); NEAR.add(re); return re; };

const CLAIMS = {
  test: [
    /\b(?:all\s+)?(?:the\s+)?(?:\d+\s+)?(?:(?:unit|integration|e2e|existing|new|remaining)\s+)?tests?\s+(?:now\s+|all\s+|still\s+)?(?:pass(?:es|ed|ing)?|are\s+(?:all\s+)?(?:passing|green)|succeed(?:s|ed)?)\b/i,
    /\btest\s+suite\s+(?:now\s+)?(?:passes|passed|is\s+green|is\s+passing)\b/i,
    /\b\d+\s*\/\s*\d+\s+(?:tests?\s+)?pass/i,
    /\btest(?:ler|lerin)?\s+(?:hepsi\s+|tümü\s+)?(?:başarıyla\s+)?geç(?:ti|iyor|tiler|iyorlar)/iu,
    /tüm\s+testler\s+(?:başarılı|geçti|geçiyor|yeşil)|testler\s+(?:yeşil|başarılı)/iu,
    /\b(?:todas\s+las\s+)?(?:pruebas|tests)\s+(?:ya\s+)?(?:pasan|pasaron|est[aá]n\s+pasando)/iu, // es
    /\b(?:todos\s+os\s+)?testes\s+(?:agora\s+)?(?:passam|passaram|est[aã]o\s+passando)/iu, // pt
    /\b(?:alle\s+)?tests\s+(?:sind\s+)?(?:bestanden|laufen\s+durch|grün|erfolgreich)/iu, // de
    /\b(?:tous\s+les\s+)?tests\s+(?:passent|sont\s+(?:au\s+)?verts?|réussissent)/iu, // fr
    /(?:所有|全部)?测试(?:全部|都)?(?:已)?通过/u, // zh
    near('\\btests?\\b|testler|pruebas|testes|测试'),
  ],
  build: [
    /\b(?:the\s+)?build\s+(?:now\s+|still\s+)?(?:succeeds|succeeded|passes|passed|is\s+(?:green|clean|successful|passing)|works|completes|completed)\b/i,
    /\bbuilds?\s+(?:successfully|cleanly|fine|without\s+errors)\b/i,
    /\bcompiles?\s+(?:successfully|cleanly|fine|without\s+(?:errors|warnings))\b/i,
    /\bsuccessfully\s+(?:built|compiled)\b|\bclean\s+build\b/i,
    /(?:build|derleme)\s+(?:başarılı|başarıyla|sorunsuz)|hatasız\s+derlen/iu,
    /compila(?:ción|ção)?\s+(?:correctamente|sin\s+errores|com\s+sucesso|sem\s+erros)|build\s+(?:exitoso|bem[- ]sucedido)/iu, // es, pt
    /(?:build|kompiliert)\s+(?:ist\s+)?(?:erfolgreich|fehlerfrei|ohne\s+Fehler)/iu, // de
    /(?:compile|build)\s+(?:sans\s+erreur|avec\s+succès|réussi)/iu, // fr
    /构建成功|编译(?:成功|通过)/u, // zh
    near('\\bbuild\\b|derleme'),
  ],
  typecheck: [
    /\bno\s+(?:more\s+)?(?:type|typescript|ts|mypy|pyright)\s+errors\b/i,
    /\btype[- ]?check(?:s|ing|er)?\s+(?:now\s+)?(?:passes|passed|is\s+clean|clean|succeeds)\b/i,
    /\btypes?\s+check\s+out\b|\btsc\s+(?:passes|is\s+clean|is\s+happy)\b/i,
    /tip\s+hatası\s+(?:yok|kalmadı)/iu,
    near('typecheck|type-check|\\btsc\\b|mypy|pyright'),
  ],
  lint: [
    /\blint(?:er|ing)?\s+(?:now\s+)?(?:passes|passed|is\s+clean|clean|is\s+happy)\b/i,
    /\bno\s+(?:more\s+)?lint(?:ing)?\s+(?:errors|warnings|issues)\b/i,
    /\b(?:eslint|ruff|clippy|flake8|pylint)\s+(?:passes|is\s+clean|clean|reports\s+nothing)\b/i,
    /lint\s+(?:hatası\s+yok|temiz)/iu,
    near('\\blint\\b|eslint|clippy'),
  ],
  works: [
    /\bI(?:'ve|\s+have)?\s+(?:verified|confirmed|tested)\b/i,
    /\bverified\s+(?:that|it|the)\b/i,
    /\b(?:it|this|everything|the\s+fix|the\s+app|the\s+page|the\s+feature)\s+(?:now\s+)?works\b/i,
    /\bworks\s+(?:now|correctly|as\s+expected|perfectly)\b/i,
    /\bfixed\s+and\s+(?:verified|tested)\b/i,
    /doğruladım|test\s+ettim|(?:artık|şimdi)\s+(?:sorunsuz\s+)?çalışıyor/iu,
  ],
};

// A sentence that hedges, admits a gap, or talks about the past is honest — never flag it.
const HEDGE = /\b(?:not|never|no\s+longer|haven't|hasn't|have\s+not|has\s+not|couldn't|could\s+not|can't|cannot|didn't|did\s+not|wasn't|weren't|won't|unable|unverified|untested|should|would|might|may|once|if|unless|whether|make\s+sure|ensure|please\s+run|you\s+can\s+run|to\s+verify|to\s+confirm|to\s+check|expected\s+to|hopefully|probably|likely|assum\w*|before\s+(?:my|the|this|your)|previously|originally|baseline|used\s+to|on\s+main|TODO)\b|çalıştırmadım|çalıştıramadım|doğrulamadım|test\s+etmedim|edemedim|yapamadım|değil|olmalı|gerekiyor|gerekir|muhtemelen|umarım|eğer|lütfen|önceden|daha\s+önce|\p{L}+(?:medim|madım|medik|madık|memiş|mamış|miyor|mıyor|meyecek|mayacak)(?!\p{L})/iu;
// Same idea for es / pt / de / fr / zh. Letter lookarounds instead of \b, which is ASCII-only.
const W = (words) => new RegExp(`(?<!\\p{L})(?:${words})(?!\\p{L})`, 'iu');
const HEDGE_INTL = [
  W('aún\\s+no|todavía\\s+no|no\\s+(?:he|hemos|ejecut\\p{L}*|prob\\p{L}*)|debería\\p{L}*|podría\\p{L}*|probablemente|antes\\s+de\\s+mi'),
  W('não|deveria\\p{L}*|deve(?:m)?\\s+passar|provavelmente|ainda\\s+não|antes\\s+da\\s+minha'),
  W('nicht|noch\\s+nicht|sollte\\p{L}*|wahrscheinlich|falls|wenn|vor\\s+meiner'),
  W('ne|pas|devrai\\p{L}*|probablement|si|avant\\s+mon'),
  /应该|没有|未|尚未|可能|如果|之前/u,
];

function detectClaims(text) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    // Inline code keeps its words ("`npm test` passes") but not its check marks (an example status line isn't a claim).
    .replace(/`([^`]*)`/g, (m, code) => code.replace(/[✅✓✔☑]/gu, ''))
    // Quoted text is someone's words or an example, not this message's claim: “All tests pass ✅”.
    .replace(/“[^”\n]{0,160}”|"[^"\n]{0,160}"|«[^»\n]{0,160}»/g, ' ');
  const sentences = clean.split(/(?<=[.!?])\s+|(?<=[。！？])\s*|\n+/).map((s) => s.trim()).filter(Boolean);
  const claims = [];
  for (const s of sentences) {
    if (/[?？]$/.test(s) || HEDGE.test(s) || HEDGE_INTL.some((re) => re.test(s))) continue;
    for (const cat of Object.keys(CLAIMS)) {
      if (claims.some((c) => c.cat === cat)) continue;
      // Table rows and headings are usually plans or status boards: only explicit wording counts there,
      // and never the loose "works" category.
      const board = /^(?:\||#{1,6}\s)/.test(s);
      if (board && cat === 'works') continue;
      if (CLAIMS[cat].some((re) => !(board && NEAR.has(re)) && re.test(s))) {
        claims.push({
          cat, quote: short(s.replace(/^[-*•>\s]+/, ''), 110),
          all: /\ball\b|\bevery\b|\btüm|\bhepsi|\btümü|\btodas\b|\btodos\b|\balle\b|\btous\b|所有|全部/iu.test(s),
          count: cat === 'test' ? claimedCount(s) : null,
        });
      }
    }
  }
  return claims;
}

// The number inside the pass phrase itself ("all 142 tests pass", "142/142 passed"), never "added 3 new tests".
function claimedCount(s) {
  if (/(?:~|≈|\babout|\baround|\bover|\bmore\s+than|\bnearly|\balmost|\broughly|yaklaşık|civarı)\s*\d|\d\+/iu.test(s)) return null;
  // "3 of 4 tests pass" claims 3; "all 3 core tests pass" names what the 3 are.
  const patterns = [
    /\b(\d+)\s*(?:\/\s*\d+\s*|\s+(?:of|out\s+of)\s+\d+\s+)?(?:(?:unit|integration|e2e|[a-z][\w-]*)\s+)?tests?\s+(?:now\s+|all\s+|still\s+)?(?:pass|are\s+passing|passing|passed|succeed)/i,
    /\ball\s+(\d+)\s+(?:(?:unit|integration|e2e|[a-z][\w-]*)\s+)?(?:tests?\s+)?(?:pass|are\s+green)/i,
    /\b(\d+)\s+(?:tests?\s+)?(?:passed|passing)\b/i,
    /(\d+)\s+test(?:in|lerin)?\s+(?:tamamı\s+|tümü\s+|hepsi\s+)?(?:başarıyla\s+)?geç/iu,
  ];
  for (const re of patterns) { const m = re.exec(s); if (m) return Number(m[1]); }
  return null;
}

module.exports = { detectClaims };
