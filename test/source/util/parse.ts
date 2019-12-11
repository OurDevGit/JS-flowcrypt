import { ParsedMail, simpleParser } from "mailparser";

type ThreadIdObject = {
    threadId: string;
};


export class ParseMsgResult {
    threadId?: string;
    mimeMsg: ParsedMail;
}


const strictParse = async (source: string): Promise<ParseMsgResult> => {
  const lines = source.split('\n');
  const result = new ParseMsgResult();
  if (lines[1] === 'Content-Type: application/json; charset=UTF-8' && lines[3]) {
    const threadIdObject = JSON.parse(lines[3]) as ThreadIdObject;
    result.threadId = threadIdObject.threadId;
  } else {
    throw new Error('ThreadId property doesn\'t exist');
  }
  if (lines[6] === 'Content-Type: message/rfc822' &&
        lines[7] === 'Content-Transfer-Encoding: base64' && lines[9]) {
    result.mimeMsg = await convertBase64ToMimeMsg(lines[9]);
  } else {
    throw new Error('Base64 MIME Msg wasn\'t found');
  }
  return result;
};

const convertBase64ToMimeMsg = async (base64: string) => {
  const base64Buffer = Buffer.from(base64, 'base64');
  return await simpleParser(base64Buffer.toString());
};

export default { strictParse, convertBase64ToMimeMsg };
