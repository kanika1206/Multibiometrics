import React, { Component } from 'react';
import { loadCaptchaEnginge, LoadCanvasTemplate, LoadCanvasTemplateNoReload, validateCaptcha } from 'react-simple-captcha';
import './element.css'

class CaptchaTest extends Component {

   componentDidMount () {
      loadCaptchaEnginge(6); 
   };

   render() {
        

       return (<div>
           <div className="container">
               <div className="form-group">

                   <div className="col mt-3">
                       <LoadCanvasTemplateNoReload />
                   </div>
                     
               </div>

           </div>
       </div>);
   };
}

export default CaptchaTest;