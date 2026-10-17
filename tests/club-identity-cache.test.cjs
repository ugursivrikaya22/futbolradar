const test = require('node:test');
const assert = require('node:assert/strict');
const { sameClub } = require('../services/superLigTeams');
const { nationKey } = require('../services/displayLabels');

test('bounded identity caches preserve aliases, national teams and reserve boundaries after eviction', () => {
  const cases = [
    ['Rizespor', 'Çaykur Rizespor', true],
    ['Italy', 'İtalya', true],
    ['Turkey', 'Türkiye', true],
    ['Amed', 'Amed Sportif Faaliyetler', true],
    ['Sporting CP', 'Sporting CP U19', false],
    ['Galatasaray', 'Galatasaray B', false],
    ['Roma', 'Romania', false],
    ['A+B', 'A+B Youth', false],
    ['', '', false],
    [null, undefined, false]
  ];
  const check = () => {
    for (const [a, b, expected] of cases) {
      assert.equal(sameClub(a, b), expected, `${a}/${b}`);
      assert.equal(sameClub(b, a), expected, `${b}/${a}`);
    }
    assert.equal(nationKey('İTALYA'), nationKey('Italy'));
    assert.equal(nationKey('Galatasaray'), null);
  };
  check();
  // Exceed both the name and pair limits without changing their semantics.
  for (let i = 0; i < 51000; i++) {
    assert.equal(sameClub(`club-${i}`, `other-${i}`), false);
    assert.equal(nationKey(`club-${i}`), null);
  }
  check();
});
