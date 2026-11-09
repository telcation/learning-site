export function executableSource(language:'java'|'python',snippet:string):string {
  const code=snippet.trim();
  if(!code)throw new Error('MISSING_LESSON_CODE');
  if(language==='python')return code+'\n';
  return 'public class OddSum {\n    public static void main(String[] args) {\n'+
    code.split('\n').map(line=>'        '+line).join('\n')+'\n    }\n}\n';
}
