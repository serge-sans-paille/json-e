const {ASTNode, UnaryOp, BinOp, Builtin, ArrayAccess, List, Object} = require("../src/AST");
const Tokenizer = require("../src/tokenizer");
const {SyntaxError} = require('./error');

let syntaxRuleError = (token) => {
    return new SyntaxError(`Found ${token.value}, expected !, (, +, -, [, false, identifier, null, number, string, true, {`);
};

class Parser {
    constructor(tokenizer, source, offset = 0) {
        this._source = source;
        this._tokenizer = tokenizer;
        this.current_token = this._tokenizer.next(this._source, offset);
        this.unaryOpTokens = ["-", "+", "!"];
        this.primitivesTokens = ["number", "null", "true", "false"];
        this.operations = [["||"], ["&&"], ["in"], ["==", "!="], ["<", ">", "<=", ">="], ["+", "-"], ["*", "/"], ["**"]];
    }

    takeToken(...kinds) {
        if (kinds.length > 0 && kinds.indexOf(this.current_token.kind) === -1) {
            throw syntaxRuleError(this.current_token);
        }
        try {
            this.current_token = this._tokenizer.next(this._source, this.current_token.end);
        } catch (err) {
            throw err;
        }
    }

    parse(level = 0) {
        let node
        if (level == this.operations.length - 1) {
            node = this.factor();
            let token = this.current_token;

            for (; token != null && this.operations[level].indexOf(token.kind) !== -1; token = this.current_token) {
                this.takeToken(token.kind);
                node = new BinOp(token, this.parse(level), node);
            }
        } else {
            node = this.parse(level + 1);
            let token = this.current_token;

            for (; token != null && this.operations[level].indexOf(token.kind) !== -1; token = this.current_token) {
                this.takeToken(token.kind);
                node = new BinOp(token, node, this.parse(level + 1));
            }
        }

        return node
    }

    factor() {
        //    factor : unaryOp factor | primitives | (string | list | builtin) (valueAccess)? | LPAREN expr RPAREN |object
        let token = this.current_token;
        let node;
        let isUnaryOpToken = this.unaryOpTokens.indexOf(token.kind) !== -1;
        let isPrimitivesToken = this.primitivesTokens.indexOf(token.kind) !== -1;

        if (isUnaryOpToken) {
            this.takeToken(token.kind);
            node = new UnaryOp(token, this.factor());
        } else if (isPrimitivesToken) {
            this.takeToken(token.kind);
            node = new ASTNode(token);
        } else if (token.kind == "string") {
            this.takeToken(token.kind);
            node = new ASTNode(token);
            node = this.valueAccess(node)
        } else if (token.kind == "(") {
            this.takeToken("(");
            node = this.parse();
            this.takeToken(")");
        } else if (token.kind == "[") {
            node = this.list();
            node = this.valueAccess(node)
        } else if (token.kind == "{") {
            node = this.object();
        } else if (token.kind == "identifier") {
            node = this.builtins();
            node = this.valueAccess(node)
        }

        return node
    }

    builtins() {
        //    builtins : ID((LPAREN (expr ( COMMA expr)*)? RPAREN)? | (DOT ID)*)
        let args = null;
        let token = this.current_token;
        let node;
        this.takeToken("identifier");

        if (this.current_token != null && this.current_token.kind == "(") {
            args = [];
            this.takeToken("(");
            if (this.current_token.kind != ")") {
                node = this.parse();
                args.push(node);

                while (this.current_token.kind == ",") {
                    this.takeToken(",");
                    node = this.parse();
                    args.push(node)
                }
            }
            this.takeToken(")")
        }
        node = new Builtin(token, args);
        for (token = this.current_token; token != null && token.kind == "."; token = this.current_token) {
            this.takeToken(".");
            let right = new ASTNode(this.current_token);
            this.takeToken(this.current_token.kind)
            node = new BinOp(token, node, right);
        }

        return node
    }

    list() {
        //    list : LSQAREBRAKET (expr ( COMMA expr)*)? RSQAREBRAKET)
        let node;
        let arr = [];
        let token = this.current_token;
        this.takeToken("[");

        if (this.current_token.kind != "]") {
            node = this.parse();
            arr.push(node);

            while (this.current_token.kind == ",") {
                this.takeToken(",");
                node = this.parse();
                arr.push(node)
            }
        }
        this.takeToken("]");
        node = new List(token, arr);
        return node
    }

    valueAccess(node) {
        //    valueAccess : (LSQAREBRAKET expr |(expr? SEMI expr?)  RSQAREBRAKET)(LSQAREBRAKET expr
        //   |(expr? SEMI expr?)  RSQAREBRAKET))*
        let leftArg = null, rightArg = null;
        let token;
        let isInterval = false;

        for (token = this.current_token; token && token.kind == "[";) {
            this.takeToken("[");

            if (this.current_token.kind != ":") {
                leftArg = this.parse();
            }
            if (this.current_token.kind == ":") {
                isInterval = true;
                this.takeToken(":");
                if (this.current_token.kind != "]") {
                    rightArg = this.parse();
                }
            }
            this.takeToken("]");
            node = new ArrayAccess(token, node, isInterval, leftArg, rightArg);
            token = this.current_token
        }

        return node;
    }

    object() {
        //    object : LCURLYBRACE ( STR | ID SEMI expr (COMMA STR | ID SEMI expr)*)? RCURLYBRACE (DOT ID)?
        let node;
        let obj = {};
        let key, value;
        let token = this.current_token;
        this.takeToken("{");

        while (this.current_token.kind == "string" || this.current_token.kind == "identifier") {
            key = this.current_token.value;
            if (this.current_token.kind == "string") {
                key = parseString(key);
            }
            this.takeToken(this.current_token.kind);
            this.takeToken(":");
            value = this.parse();
            obj[key] = value;
            if (this.current_token.kind == "}") {
                break;
            } else {
                this.takeToken(",")
            }
        }
        this.takeToken("}");
        node = new Object(token, obj);

        for (token = this.current_token; token != null && token.kind == "."; token = this.current_token) {
            this.takeToken(".");
            let right = new ASTNode(this.current_token);
            this.takeToken(this.current_token.kind);
            node = new BinOp(token, node, right);
        }
        return node;
    }

}

let
    parseString = (str) => {
        return str.slice(1, -1);
    };

let
    createTokenizer = function () {
        let tokenizer = new Tokenizer({
                ignore: '\\s+', // ignore all whitespace including \n
                patterns: {
                    number: '[0-9]+(?:\\.[0-9]+)?',
                    identifier: '[a-zA-Z_][a-zA-Z_0-9]*',
                    string: '\'[^\']*\'|"[^"]*"',
                    // avoid matching these as prefixes of identifiers e.g., `insinutations`
                    true: 'true(?![a-zA-Z_0-9])',
                    false: 'false(?![a-zA-Z_0-9])',
                    in: 'in(?![a-zA-Z_0-9])',
                    null: 'null(?![a-zA-Z_0-9])',
                },
                tokens: [
                    '**', ...'+-*/[].(){}:,'.split(''),
                    '>=', '<=', '<', '>', '==', '!=', '!', '&&', '||',
                    'true', 'false', 'in', 'null', 'number',
                    'identifier', 'string',
                ]
            }
        );
        return tokenizer
    };


exports
    .Parser = Parser;
exports
    .createTokenizer = createTokenizer;