/*  Third party */

/* //= ../../bower_components/jquery/dist/jquery.min.js */

/* Custom */

window.log = function(param){
    console.log(param);
};
var // TODO: make some oop and refactoring
  favoriteColor = document.getElementById('favoriteColor'),
  fillColor = document.getElementById('fillColor'),
  datepicker = document.getElementById('date'),
  button = document.getElementById('submit'),
  checkbox = document.getElementById('checkbox'),
  bLabel = document.getElementById('bLabel'),
  fLabel = document.getElementById('fLabel'),
  note = { date: '1970-12-27', favoriteColor: '#00ffff', fillColor: '#cccccc' },
  stylesheet = document.styleSheets[0],
  stylesheetRule,
  RULE_LENGTH;

// crossbrowsers stuff
if (stylesheet.cssRules) {
  stylesheetRule = stylesheet.cssRules;
} else if (stylesheet.rules) {
  stylesheetRule = stylesheet.rules;
}

RULE_LENGTH = stylesheetRule.length;


function setData(obj) {
  datepicker.value = obj.date;
  favoriteColor.value = obj.favoriteColor;
  fillColor.value = obj.fillColor;
  bLabel.style.backgroundColor = obj.favoriteColor;
  fLabel.style.backgroundColor = obj.fillColor;
}

setData(note);

function getWeekNumber(d) {
  d = new Date(+d);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  var yearStart = new Date(d.getFullYear(), 0, 1);
  var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  if (weekNo > 52) {
    weekNo = 52;
  }
  return [d.getFullYear(), weekNo];
}

var YEAR = getWeekNumber(new Date())[0];
var WEEK = getWeekNumber(new Date())[1];

// set styles
function cleanRules() {
  for (var i = stylesheetRule.length - 1; i > RULE_LENGTH - 1; i--) {
    stylesheet.deleteRule(i);
  }
}

function fillWeek(row, week, color) {
  var rule;
  rule = '.row-'.concat(row, ' .week:nth-child(-n+');
  rule = rule.concat(week, ')::before {border-color: ');
  rule = rule.concat(color, '}');
  stylesheet.insertRule(rule, stylesheetRule.length);
}

function fillRow(int, color) {
  // table rows max is 100 and 54 columns (2 columns for borders)
  for (var i = 1; i < int && i < 101; i++) {
    fillWeek(i, 53, color);
  }
}

function fillColumn(dayOfBirth, color) {
  var weekOfBirth = getWeekNumber(dayOfBirth)[1];
  // add +1 to weekOfBirth because of first table column is border column
  var rule = '.week:nth-child('.concat(weekOfBirth + 1);
  rule = rule.concat(')::before {border-color: ', color, ';}');
  stylesheet.insertRule(rule, stylesheetRule.length);
}

function printYear(year) {
  var rule = '@media print { .row-1::after {content: "'.concat(year, '"}}');
  stylesheet.insertRule(rule, stylesheetRule.length);
}


// cookie
function setCookie(obj) {
  var d = new Date(),
    exdays = 365,
    expires;
  d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
  expires = 'expires='.concat(d.toUTCString());
  document.cookie = 'data='.concat(btoa(JSON.stringify(obj)), ';', expires);
}

function getCookie(name) {
  var value = ';'.concat(document.cookie, ';');
  var parts = value.split(';'.concat(name, '='));
  if (parts.length == 2) {
    return JSON.parse(atob(parts.pop().split(';').shift()));
  } else {
    return false;
  }
}

// main
function rewriteAll(obj) {
  var dayOfBirth = new Date(obj.date);
  var yearOfBirth = dayOfBirth.getFullYear();
  var fullYear = YEAR - yearOfBirth;

  setData(obj);
  cleanRules();
  fillColumn(dayOfBirth, obj.favoriteColor);
  fillRow(fullYear, obj.fillColor);
  fillWeek(fullYear, WEEK, obj.fillColor);
  printYear(yearOfBirth);
  setCookie(obj);
  checkbox.checked = false;
}

// events
datepicker.onchange = function setdatepicker() {
  note.date = datepicker.value;
};

favoriteColor.onchange = function setFavoriteColor() {
  bLabel.style.backgroundColor = favoriteColor.value;
  note.favoriteColor = favoriteColor.value;
};

fillColor.onchange = function setFillColor() {
  fLabel.style.backgroundColor = fillColor.value;
  note.fillColor = fillColor.value;
};

checkbox.onchange = function unchecked() {
  var cookie = getCookie('data');
  if (!checkbox.checked && cookie) {
    rewriteAll(note);
  }
};

button.onclick = function tapButton() {
  note.date = datepicker.value;
  note.favoriteColor = favoriteColor.value;
  note.fillColor = fillColor.value;
  rewriteAll(note);
};

window.onload = function firstLoad() {
  var cookie = getCookie('data');
  if (cookie) {
    note = cookie;
    rewriteAll(note);
  } else {
    checkbox.checked = true;
  }
};
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyJtYWluLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qICBUaGlyZCBwYXJ0eSAqL1xuXG4vKiAvLz0gLi4vLi4vYm93ZXJfY29tcG9uZW50cy9qcXVlcnkvZGlzdC9qcXVlcnkubWluLmpzICovXG5cbi8qIEN1c3RvbSAqL1xuXG4vLz0gY29tcG9uZW50cy9oZWxwZXIuanNcbi8vPSBjb21wb25lbnRzL3Rlc3QuanNcbiJdLCJmaWxlIjoibWFpbi5qcyJ9
