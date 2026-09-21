// An editorial lead lasts until its explicit deadline. A newer, higher
// importance breaking story supersedes it without removing either article.
function promotedNewsId(rows, now = new Date()) {
  const time = new Date(now).getTime();
  const published = row => Date.parse(row.publishedAt || row.timestamp || row.at);
  const importance = row => Number(row.editorialPriority || 0);
  const eligible = rows.filter(row => published(row) <= time);
  const leads = eligible.filter(row => Date.parse(row.featuredUntil) > time)
    .sort((a, b) => importance(b) - importance(a) || published(b) - published(a));
  const lead = leads[0];
  if (!lead) return null;
  const replacement = eligible.filter(row =>
    published(row) > published(lead) && importance(row) > importance(lead) &&
    (row.isBreaking || row.breaking || row.ticker?.breaking) &&
    time - published(row) < 24 * 3600000)
    .sort((a, b) => importance(b) - importance(a) || published(b) - published(a))[0];
  return (replacement || lead).id;
}
module.exports = { promotedNewsId };
