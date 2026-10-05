"use strict";

const { UserError } = require("../core/errors");

/**
 * A small, safe calculator used by .calc. It is a hand-written recursive-descent parser:
 * user input is never passed to eval/Function, so nothing but arithmetic can run.
 *
 *   expr   := term (("+" | "-") term)*
 *   term   := unary (("*" | "/" | "%") unary | implicit unary)*
 *   unary  := ("-" | "+") unary | power
 *   power  := postfix ("^" unary)?             (right associative)
 *   postfix:= atom "!"*
 *   atom   := number | constant | func "(" expr ("," expr)* ")" | "(" expr ")"
 */

const MAX_INPUT = 200;
const MAX_DEPTH = 50;

const CONSTANTS = { pi: Math.PI, π: Math.PI, e: Math.E, tau: Math.PI * 2 };
const deg = (x) => (x * Math.PI) / 180;
const FUNCTIONS = {
  sqrt: [1, Math.sqrt],
  cbrt: [1, Math.cbrt],
  abs: [1, Math.abs],
  round: [1, Math.round],
  floor: [1, Math.floor],
  ceil: [1, Math.ceil],
  ln: [1, Math.log],
  log: [1, Math.log10],
  log2: [1, Math.log2],
  exp: [1, Math.exp],
  // Trigonometry in degrees, which is what people in a chat expect.
  sin: [1, (x) => Math.sin(deg(x))],
  cos: [1, (x) => Math.cos(deg(x))],
  tan: [1, (x) => Math.tan(deg(x))],
  asin: [1, (x) => (Math.asin(x) * 180) / Math.PI],
  acos: [1, (x) => (Math.acos(x) * 180) / Math.PI],
  atan: [1, (x) => (Math.atan(x) * 180) / Math.PI],
  min: [-1, Math.min],
  max: [-1, Math.max],
  pow: [2, Math.pow],
};

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) throw new UserError("Factorial needs a whole number ≥ 0.");
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function tokenize(input) {
  const src = input
    .replace(/(?<=[\d)\s])[xX](?=[\s\d(.])/g, "*") // "2 x 3" but not the x in "max"/"exp"
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/\*\*/g, "^");
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([a-zπ][a-z0-9]*)|(.))/giy;
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1] !== undefined) tokens.push({ type: "num", value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ type: "id", value: m[2].toLowerCase() });
    else if (m[3] !== undefined && m[3].trim()) {
      if (!"+-*/%^()!,".includes(m[3])) throw new UserError(`I don't understand "${m[3]}".`);
      tokens.push({ type: "op", value: m[3] });
    }
  }
  return tokens;
}

function evaluate(input) {
  const text = String(input || "").trim();
  if (!text) throw new UserError("Nothing to calculate.");
  if (text.length > MAX_INPUT) throw new UserError(`The expression is too long (max ${MAX_INPUT} characters).`);
  const tokens = tokenize(text);
  let pos = 0;
  let depth = 0;

  const peek = () => tokens[pos];
  const isOp = (v) => peek()?.type === "op" && peek().value === v;
  const expect = (v) => {
    if (!isOp(v)) throw new UserError(`Expected "${v}".`);
    pos++;
  };
  const enter = () => {
    if (++depth > MAX_DEPTH) throw new UserError("The expression is nested too deeply.");
  };

  function expr() {
    enter();
    let v = term();
    while (isOp("+") || isOp("-")) v = tokens[pos++].value === "+" ? v + term() : v - term();
    depth--;
    return v;
  }
  function term() {
    let v = unary();
    for (;;) {
      const op = isOp("*") || isOp("/") || isOp("%") ? tokens[pos++].value : null;
      // No operator before a number, name or "(" means implicit multiplication: 2pi, 3(4+1)
      const implicit = !op && peek() && (peek().type === "num" || peek().type === "id" || isOp("("));
      if (!op && !implicit) return v;
      const rhs = unary();
      if (op === "/") v /= rhs;
      else if (op === "%") v %= rhs;
      else v *= rhs;
    }
  }
  // Sign binds looser than "^", as in maths: -2^2 = -(2^2) = -4, while 2^-1 = 0.5.
  function unary() {
    if (isOp("-") || isOp("+")) {
      const sign = tokens[pos++].value === "-" ? -1 : 1;
      enter();
      const v = unary();
      depth--;
      return sign * v;
    }
    return power();
  }
  function power() {
    const base = postfix();
    if (isOp("^")) {
      pos++;
      enter();
      const exp = unary();
      depth--;
      return base ** exp;
    }
    return base;
  }
  function postfix() {
    let v = atom();
    while (isOp("!")) {
      pos++;
      v = factorial(v);
    }
    return v;
  }
  function atom() {
    const t = tokens[pos++];
    if (!t) throw new UserError("The expression ends too early.");
    if (t.type === "num") return t.value;
    if (t.type === "op" && t.value === "(") {
      const v = expr();
      expect(")");
      return v;
    }
    if (t.type === "id") {
      if (Object.hasOwn(CONSTANTS, t.value)) return CONSTANTS[t.value];
      const fn = Object.hasOwn(FUNCTIONS, t.value) ? FUNCTIONS[t.value] : null;
      if (!fn) throw new UserError(`Unknown name "${t.value}".`);
      expect("(");
      const args = [expr()];
      while (isOp(",")) {
        pos++;
        args.push(expr());
      }
      expect(")");
      if (fn[0] >= 0 && args.length !== fn[0]) throw new UserError(`${t.value}() takes ${fn[0]} argument(s).`);
      return fn[1](...args);
    }
    throw new UserError(`Unexpected "${t.value}".`);
  }

  const result = expr();
  if (pos < tokens.length) throw new UserError(`Unexpected "${tokens[pos].value}".`);
  if (Number.isNaN(result)) throw new UserError("The result is not a number.");
  return result;
}

/** Formats a result without floating-point noise (0.1+0.2 → 0.3). */
function formatNumber(n) {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : n < 0 ? "-∞" : "undefined";
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return n.toLocaleString("en-US");
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-6 || abs >= 1e21)) return n.toExponential(8).replace(/\.?0+e/, "e");
  return String(Number(n.toPrecision(12)));
}

module.exports = { evaluate, formatNumber, tokenize };
