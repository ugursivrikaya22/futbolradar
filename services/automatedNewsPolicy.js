// Conservative intake gate; existing manually edited archives are untouched.
function allowAutomatedNews(title, official) {
  const value=String(title||'').toLocaleLowerCase('tr-TR');
  if(/iddia|söylenti|kulis|olabilir|rumou?r|reportedly|alleged|linked with|could join/.test(value)) return false;
  if(/transfer|sakat|injur|doping|bahis|betting|şike|match.fix|suç|arrest|assault|sözleşme|contract|bonservis/.test(value)) return official===true;
  return true;
}
module.exports={allowAutomatedNews};
