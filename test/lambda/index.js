exports.handler = async (event) => {
    const parsed = JSON.parse(event);
    const product = parsed.num1 * parsed.num2;
    const response = {
        statusCode: 200,
        body: `The product of ${parsed.num1} and ${parsed.num2} is ${product}`,
    };
    return response;
};
