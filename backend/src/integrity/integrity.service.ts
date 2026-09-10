import {BadRequestException,Inject,Injectable,NotFoundException} from '@nestjs/common';
import {AcademicService} from '../academic/academic.service';
import {compareCodeSamples,type CodeSample} from './code-similarity';

@Injectable()
export class IntegrityService {
  constructor(@Inject(AcademicService) private readonly academic:AcademicService){}
  async analyze(userId:string,u:string,assessmentId:string){
    const result=await this.academic.scope(userId,u,async c=>{
      const access=(await c.query<{allowed:boolean}>('select private.manages_assessment($1,$2) allowed',[u,assessmentId])).rows[0];
      if(!access.allowed)throw new NotFoundException('Devoir introuvable ou non accessible à cet enseignant.');
      const size=(await c.query<{copies:number;characters:string}>(`select count(distinct a.submission_id)::int copies,coalesce(sum(length(a.answer_text)),0) characters
        from public.submission_answers a where a.university_id=$1 and a.assessment_id=$2 and a.question->>'type'='CODE'`,[u,assessmentId])).rows[0];
      if(size.copies>200||Number(size.characters)>2000000)throw new BadRequestException('Cette analyse interactive est limitée à 200 copies et 2 millions de caractères. Un traitement en file est nécessaire pour ce volume.');
      const samples=(await c.query<CodeSample>(`select a.submission_id,s.student_id,coalesce(p.full_name,'Étudiant (profil non visible)') student_name,a.question_id,
        a.question->>'title' question_title,a.question->>'runtime' runtime,a.question->>'starter_code' starter_code,a.answer_text
        from public.submission_answers a join public.submissions s on s.id=a.submission_id left join public.profiles p on p.id=s.student_id
        where a.university_id=$1 and a.assessment_id=$2 and a.question->>'type'='CODE' order by a.question_id,a.submission_id limit 6000`,[u,assessmentId])).rows;
      return {copies:size.copies,samples};
    });
    const analysis=compareCodeSamples(result.samples);
    return {...analysis,copies_analyzed:result.copies,code_answers:result.samples.length,analyzed_at:new Date().toISOString(),
      notice:'Ces indicateurs mesurent des séquences de code communes entre copies remises. Ils ne détectent pas l’auteur, ne mesurent pas une probabilité d’IA et ne prouvent pas une fraude. Le code initial est exclu ; une solution attendue commune peut encore produire une forte similarité. Vérifiez le contexte avec les étudiants. Aucune note ni sanction n’est modifiée.',
      limitations:'Comparaison lexicale locale, sensible au renommage et aux transformations du code. Les réponses trop courtes sont ignorées. Les fichiers Web sont réunis avant comparaison ; aucun code n’est exécuté ni envoyé à un service externe.'};
  }
}
