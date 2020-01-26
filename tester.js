"use strict";
class ValueExpectation {
    constructor(value) {
        this.value = value;
    }

    isValid(output) {
        if (output === this.value) {
            return true;
        }
        if (typeof (output) === "object" && typeof (this.value) === "object") {
            for (let key in output) {
                if (!new ValueExpectation(output[key]).isValid(this.value[key])) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    toString() {
        return "" + this.value;
    }
}

class AnyOfExpectation {
    constructor(expectations) {
        this.expectations = expectations;
    }

    isValid(output) {
        for (let expectation of this.expectations) {
            if (expectation.isValid(output)) {
                return true;
            }
        }
        return false;
    }

    toString() {
        return " one of " + this.expectations.join(", ");
    }
}

class Tester {
    constructor(func) {
        this.passing_tests = 0;
        this.func = func;
    }

    passedTests() {
        if (this.passing_tests > 0) {
            console.log("\u001b[32m✓ " + this.passing_tests + " passed\x1b[0m");
            this.passing_tests = 0;
        }
    }

    test(input, expectation) {
        let error = false;
        let invalid;
        try {
            let out = this.func(input);
            if (!expectation.isValid(out)) {
                error = true;
                invalid = out;
            }
        } catch (e) {
            error = true;
            invalid = e.toString();
        }
        if (error) {
            this.passedTests();
            console.log("\x1b[31m✗ failed \n" + input + "\n became \n" + invalid + "\n instead of \n" + expectation.toString() + "\x1b[0m");
        } else {
            this.passing_tests++;
        }
    }

    testEquals(input, value) {
        return this.test(input, new ValueExpectation(value));
    }

    testAll(tests, expectation) {
        let tests_exist = false;
        if (Array.isArray(tests)) {
            for (let i = 0; i < tests.length; i += 2) {
                this.test(tests[i], new expectation(tests[i + 1]));
                tests_exist = true;
            }
        } else {
            for (let input in tests) {
                this.test(input, new expectation(tests[input]));
                tests_exist = true;
            }
        }
        if (!tests_exist) {
            console.log("\x1b[33m⚠️ No tests\x1b[0m");
        } else {
            this.passedTests();
        }
    }

    testEqualsAll(tests) {
        return this.testAll(tests, ValueExpectation);
    }
}

class BulkTester {
    constructor(namespace) {
        this.namespace = namespace;
    }

    testAll(tests, expectation) {
        if (Array.isArray(tests)) {
            for (let i = 0; i < tests.length; i += 2) {
                console.log("\x1b[1m\x1b[36m" + tests[i] + "\x1b[0m");
                new Tester(this.namespace[tests[i]]).testAll(tests[i + 1], expectation);
            }
        } else {
            for (let funcname in tests) {
                console.log("\x1b[1m\x1b[36m" + funcname + "\x1b[0m");
                new Tester(this.namespace[funcname]).testAll(tests[funcname], expectation);
            }
        }
    }

    testEqualsAll(tests) {
        this.testAll(tests, ValueExpectation);
    }
}

module.exports = {
    AnyOfExpectation,
    ValueExpectation,
    Tester,
    BulkTester
};