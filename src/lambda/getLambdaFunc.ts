import {Lambda} from '@aws-sdk/client-lambda';

type GetLambdaFunc = {
  <TResult>(
    funcName: string,
    endpoint?: string
  ): {
    <TRequest>(payload: TRequest): Promise<TResult>;
  };
};

export const getLambdaFunc: GetLambdaFunc = (
  funcName: string,
  endpoint?: string
) => {
  const lambda = new Lambda({
    endpoint,
  });
  return async payload => {
    const result = await lambda.invoke({
      FunctionName: funcName,
      Payload: JSON.stringify(payload),
    });

    try {
      const stringResult = result.Payload?.transformToString();
      return stringResult ? JSON.parse(stringResult) : null;
    } catch {
      throw Error(
        'Unable to transform response to string. Only string results are currently supported.'
      );
    }
  };
};
