import { emptyArray } from "../helpers/ts-functions"
import { expect } from "chai"
import { FExecutionCallback } from "../helpers/basic-types"

function emptyVariable<T>() {
  return undefined as unknown as T
}

export type TFakeExec = {
  nextResponse: {
    err: string | undefined;
    success: string | undefined
  };
  setErr: (errResponse:string)=>TFakeExec
  extendedExec: (command: string, params: string[], options: Object, err: FExecutionCallback, success: FExecutionCallback) => void;
  onExec: undefined;
  executedCommands: any[]
}

export function createFakeExec(): TFakeExec {
  let nextResponse = {
    err: emptyVariable<string | undefined>(),
    success: "All went fine",
  }
  let executedCommands = emptyArray<any>()

  let fakeExec = {
    executedCommands: executedCommands,
    nextResponse: nextResponse,
    onExec: undefined,
    setErr(errResponse: string) {
      nextResponse.err = errResponse
      return fakeExec
    },
    extendedExec(command: string, params: string[], options: Object, err: FExecutionCallback, success: FExecutionCallback) {
      fakeExec.executedCommands.push({
        command: command,
        params: params,
        options: options,
        err: err,
        success: success,
      })
      if (fakeExec && fakeExec.onExec != undefined) {
        // @ts-ignore
        fakeExec.onExec(command, params, options, err, success)
      } else if (fakeExec.nextResponse) {
        if (fakeExec.nextResponse.err) {
          err(
            fakeExec.nextResponse.err ||
            "No execution response defined for " +
            JSON.stringify({ command, params, options }),
          )
        } else if (fakeExec.nextResponse.success) {
          success(fakeExec.nextResponse.success as string)
        }
      } else {
        expect.fail("No response defined!!!!")
      }
    },
  }
  return fakeExec
}
